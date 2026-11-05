// ============================================================================
//  SPECTRAL LINES  ·  draw.js  (ES module, canvas 2D, no DOM at import)
// ----------------------------------------------------------------------------
//  The spectrum painters. Each function draws into a 2D context that it
//  gets as an argument, so main.js can draw into a cached offscreen layer
//  or into the visible canvas.
//
//  EMISSION. Each line is a hot core (1 to 2 device px) and a soft halo
//  whose width grows with the brightness. The composite is 'lighter', so
//  close lines add up. A strong line gets a white centre. UV and IR lines
//  are dashed and muted. bloom() adds two blurred copies (a downscale to
//  1/6 and 1/20, then an upscale with smoothing): a cheap glow that works
//  in every browser (Safari has no ctx.filter).
//
//  ABSORPTION. A continuum (the colour of each column, dimmed) with dark
//  lines. The UV and IR parts of the continuum are dark and hatched.
//
//  EXPORTS   (jump with grep -n "<anchor>" draw.js)
//      mkCanvas ........... "export function mkCanvas"
//      drawEmission ....... "export function drawEmission"
//      drawAbsorption ..... "export function drawAbsorption"
//      bloom .............. "export function bloom"
//      slitMask ........... "export function slitMask"
//      hatch .............. "export function hatch"
// ============================================================================
import { lutRGB, lowerBound, VIS } from './core.js';

// A canvas of w x h device px (OffscreenCanvas is not used: Safari 16 lacks
// its 2D context).
export function mkCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
  return c;
}

const css = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

// Glowing lines of spec on a transparent or black layer. b: brightness
// 0..1 per line. lo..hi: the wavelength window (nm). Box x, y, w, h in
// device px. opt: { dpr, hq (gradient halos), reveal (0..1: draw only the
// lines with b >= 1 - reveal), gain, flash (Map idx -> 0..1) }.
export function drawEmission(g, spec, b, lo, hi, x, y, w, h, opt = {}) {
  const L = spec.lines, dpr = opt.dpr || 1, k = w / (hi - lo), gain = opt.gain ?? 1;
  const cut = opt.reveal == null ? 0 : 1 - opt.reveal;
  const i0 = lowerBound(L, lo - 2), core = Math.max(1, dpr * (opt.core ?? (k > 3 ? 1.6 : 1)));
  g.save();
  g.globalCompositeOperation = 'lighter';
  for (let i = i0; i < L.length && L[i][0] <= hi + 2; i++) {
    let br = b[i]; if (br < cut || br <= 0.003) continue;
    const fl = opt.flash ? (opt.flash.get(i) || 0) : 0;
    br = Math.min(1.4, br * gain + fl * 0.9);
    const wl = L[i][0], px = x + (wl - lo) * k, c = lutRGB(wl);
    const outside = wl < VIS[0] || wl > VIS[1];
    const a = outside ? 0.55 * br : br;
    const halo = (opt.halo ?? 1) * dpr * (2 + 10 * br * br + (opt.hq ? 6 * br : 0));
    if (opt.hq) {
      const gr = g.createLinearGradient(px - halo, 0, px + halo, 0);
      gr.addColorStop(0, css(c, 0)); gr.addColorStop(0.5, css(c, 0.42 * a)); gr.addColorStop(1, css(c, 0));
      g.fillStyle = gr; g.fillRect(px - halo, y, 2 * halo, h);
    } else {
      g.fillStyle = css(c, 0.16 * a); g.fillRect(px - halo / 2, y, halo, h);
      g.fillStyle = css(c, 0.22 * a); g.fillRect(px - halo / 5, y, halo / 2.5, h);
    }
    g.fillStyle = css(c, Math.min(1, a));
    if (outside) {
      const seg = Math.max(2, 4 * dpr);
      for (let yy = y; yy < y + h; yy += seg * 2) g.fillRect(px - core / 2, yy, core, Math.min(seg, y + h - yy));
    } else {
      g.fillRect(px - core / 2, y, core, h);
      if (br > 0.62) { g.fillStyle = `rgba(255,255,255,${Math.min(0.85, (br - 0.62) * 1.6)})`; g.fillRect(px - core / 4, y, core / 2, h); }
    }
  }
  g.restore();
}

// Diagonal hatch over the box (the UV or IR part of a band).
export function hatch(g, x, y, w, h, color, step = 6) {
  if (w <= 0 || h <= 0) return;
  g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.strokeStyle = color; g.lineWidth = 1; g.beginPath();
  for (let s = -h; s < w + h; s += step) { g.moveTo(x + s, y + h); g.lineTo(x + s + h, y); }
  g.stroke(); g.restore();
}

// A continuum with dark absorption lines. Same arguments as drawEmission.
export function drawAbsorption(g, spec, b, lo, hi, x, y, w, h, opt = {}) {
  const dpr = opt.dpr || 1, k = w / (hi - lo), L = spec.lines;
  const cut = opt.reveal == null ? 0 : 1 - opt.reveal;
  // The continuum, one column per 2 device px.
  const step = Math.max(1, Math.round(2 * dpr));
  for (let px = 0; px < w; px += step) {
    const wl = lo + (px + step / 2) / k, c = lutRGB(wl), out = wl < VIS[0] || wl > VIS[1];
    g.fillStyle = css(c, out ? 0.22 : 0.78);
    g.fillRect(x + px, y, step + 0.5, h);
  }
  const uvW = Math.max(0, Math.min(w, (VIS[0] - lo) * k)), irX = Math.max(0, Math.min(w, (VIS[1] - lo) * k));
  if (uvW > 0) hatch(g, x, y, uvW, h, 'rgba(0,0,0,0.35)', 7 * dpr);
  if (irX < w) hatch(g, x + irX, y, w - irX, h, 'rgba(0,0,0,0.35)', 7 * dpr);
  // A soft top and base shade, as a lit slit.
  const sh = g.createLinearGradient(0, y, 0, y + h);
  sh.addColorStop(0, 'rgba(0,0,0,0.55)'); sh.addColorStop(0.22, 'rgba(0,0,0,0)'); sh.addColorStop(0.78, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,0,0,0.55)');
  g.fillStyle = sh; g.fillRect(x, y, w, h);
  const core = Math.max(1, dpr * (k > 3 ? 1.8 : 1.1));
  for (let i = lowerBound(L, lo - 2); i < L.length && L[i][0] <= hi + 2; i++) {
    const br = b[i]; if (br < cut || br <= 0.01) continue;
    const fl = opt.flash ? (opt.flash.get(i) || 0) : 0;
    const px = x + (L[i][0] - lo) * k, a = Math.min(1, br * 1.05 + fl * 0.5);
    const halo = dpr * (1.5 + 5 * br * br);
    g.fillStyle = `rgba(0,0,0,${0.35 * a})`; g.fillRect(px - halo, y, 2 * halo, h);
    g.fillStyle = `rgba(0,0,0,${a})`; g.fillRect(px - core / 2, y, core, h);
    if (fl > 0) { g.fillStyle = `rgba(255,255,255,${0.5 * fl})`; g.fillRect(px - core / 2, y, core, h); }
  }
}

// Brightest at the centre line of the box, darker toward the top and the
// base, as the image of a slit. Use on a transparent layer of glowing lines.
export function slitMask(g, x, y, w, h, edge = 0.3) {
  g.save();
  g.globalCompositeOperation = 'destination-in';
  const gr = g.createLinearGradient(0, y, 0, y + h);
  gr.addColorStop(0, `rgba(0,0,0,${edge})`); gr.addColorStop(0.3, 'rgba(0,0,0,1)');
  gr.addColorStop(0.7, 'rgba(0,0,0,1)'); gr.addColorStop(1, `rgba(0,0,0,${edge})`);
  g.fillStyle = gr; g.fillRect(x, y, w, h);
  g.restore();
}

// Two blurred copies of src added onto g (the bloom). The chain halves the
// size five times (a bilinear halving averages 2 x 2 px, so a 1 px line
// does not drop out), then adds the 1/8 and the 1/32 copies back at full
// size. The scratch canvases stay between calls. amt scales the glow.
const chain = [];
export function bloom(g, src, amt = 1) {
  const W = src.width, H = src.height;
  let prev = src;
  for (let i = 0; i < 5; i++) {
    const w = Math.max(2, Math.round(W / (2 << i))), h = Math.max(2, Math.round(H / (2 << i)));
    let c = chain[i];
    if (!c) c = chain[i] = mkCanvas(w, h);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const cg = c.getContext('2d');
    cg.globalCompositeOperation = 'copy'; cg.imageSmoothingEnabled = true;
    cg.drawImage(prev, 0, 0, prev.width, prev.height, 0, 0, w, h);
    prev = c;
  }
  g.save();
  g.imageSmoothingEnabled = true;
  g.globalCompositeOperation = 'lighter';
  g.globalAlpha = 0.9 * amt; g.drawImage(chain[2], 0, 0, W, H);
  g.globalAlpha = 1.1 * amt > 1 ? 1 : 1.1 * amt; g.drawImage(chain[4], 0, 0, W, H);
  g.restore();
}
