// ============================================================================
//  BREADBOARD LAB  ·  instruments/display.js — drawn digits and screens
// ----------------------------------------------------------------------------
//  Instrument digits are SEGMENTS DRAWN ON CANVAS, not a font (CONTRACT 8).
//  The same code draws the panel readout and the 3D screen texture of an
//  instrument (view.screens(probeId) hands us its 2D context).
//
//  A segment is a hexagonal bar with pointed ends; the digit leans by
//  `slant` like a real LCD. Unlit segments draw as a faint ghost, so the
//  display reads as glass with segments in it, not as text.
//
//  GREP MAP
//    SEG ............ glyph -> segment bits (a b c d e f g = bit 0..6)
//    segBar ......... one bar polygon
//    drawSeg7 ....... a string of digits, '.' joins the previous digit
//    seg7Width ...... the width a string will take
//    fitCanvas ...... CSS size -> backing size at the device pixel ratio
//    screenBg ....... the glass of an instrument screen (with the breathing
//                     glow of CONTRACT 8 while the sim runs)
//    INSTR_COLORS ... trace and digit colours
// ============================================================================

export const INSTR_COLORS = {
  ch: ['#e0c126', '#4fc3e8', '#e05bb8', '#63c24c'],
  lcdInk: '#1d2420', lcdGhost: 'rgba(29,36,32,0.08)', lcdBg: '#9fb59a',
  ledInk: '#ff5a2a', ledGhost: 'rgba(255,90,42,0.08)',
  grid: 'rgba(255,255,255,0.10)', axis: 'rgba(255,255,255,0.22)', text: '#c9ccd6', dim: '#7b7e8a',
  volt: '#ff7a1a', amp: '#4fc3e8'
};

export const SEG = {
  '0': 0x3f, '1': 0x06, '2': 0x5b, '3': 0x4f, '4': 0x66, '5': 0x6d, '6': 0x7d, '7': 0x07, '8': 0x7f, '9': 0x6f,
  '-': 0x40, ' ': 0x00, '_': 0x08, A: 0x77, b: 0x7c, C: 0x39, c: 0x58, d: 0x5e, E: 0x79, F: 0x71, H: 0x76, h: 0x74,
  L: 0x38, n: 0x54, O: 0x3f, o: 0x5c, P: 0x73, r: 0x50, S: 0x6d, t: 0x78, U: 0x3e, u: 0x1c, V: 0x3e, y: 0x6e, '°': 0x63
};

// bar i of a digit box (w x h, origin top-left), as a polygon
function segBar(i, w, h, t) {
  const m = h / 2, q = t / 2;
  const hz = (x0, x1, y) => [[x0 + q, y], [x0 + t, y - q], [x1 - t, y - q], [x1 - q, y], [x1 - t, y + q], [x0 + t, y + q]];
  const vt = (x, y0, y1) => [[x, y0 + q], [x + q, y0 + t], [x + q, y1 - t], [x, y1 - q], [x - q, y1 - t], [x - q, y0 + t]];
  switch (i) {
    case 0: return hz(q, w - q, q);
    case 1: return vt(w - q, q, m);
    case 2: return vt(w - q, m, h - q);
    case 3: return hz(q, w - q, h - q);
    case 4: return vt(q, m, h - q);
    case 5: return vt(q, q, m);
    default: return hz(q, w - q, m);
  }
}

// digits per character: width w = 0.56 h, gap 0.18 h
export function seg7Width(text, h) {
  const w = h * 0.56, gap = h * 0.18;
  let n = 0;
  for (const ch of String(text)) if (ch !== '.' && ch !== ':') n++;
  return n * (w + gap);
}

// Draw `text` with its top-left at (x, y). Returns the width drawn.
export function drawSeg7(ctx, text, { x = 0, y = 0, h = 40, color = INSTR_COLORS.ledInk, ghost = INSTR_COLORS.ledGhost, slant = 0.1, glow = 0 } = {}) {
  const w = h * 0.56, gap = h * 0.18, t = Math.max(1.5, h * 0.12);
  const chars = [];
  for (const ch of String(text)) {
    if ((ch === '.' || ch === ':') && chars.length) { chars[chars.length - 1].dp = true; continue; }
    chars.push({ ch, dp: false });
  }
  ctx.save();
  ctx.translate(x, y);
  if (glow > 0) { ctx.shadowColor = color; ctx.shadowBlur = glow; }
  chars.forEach((c, k) => {
    const ox = k * (w + gap);
    const bits = SEG[c.ch] ?? SEG[String(c.ch).toUpperCase()] ?? 0;
    for (let i = 0; i < 7; i++) {
      const on = (bits >> i) & 1;
      if (!on && !ghost) continue;
      ctx.fillStyle = on ? color : ghost;
      const P = segBar(i, w, h, t);
      ctx.beginPath();
      P.forEach(([px, py], j) => { const sx = ox + px + (h - py) * slant; if (j) ctx.lineTo(sx, py); else ctx.moveTo(sx, py); });
      ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = c.dp ? color : ghost || 'transparent';
    ctx.beginPath(); ctx.arc(ox + w + gap * 0.45, h - t / 2, t * 0.55, 0, Math.PI * 2); ctx.fill();
  });
  ctx.restore();
  return chars.length * (w + gap);
}

// CSS size -> backing size; returns the context scaled to CSS pixels
export function fitCanvas(canvas, cssW, cssH, maxDpr = 2) {
  const dpr = Math.min(maxDpr, (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1) || 1);
  const W = Math.max(1, Math.round(cssW * dpr)), H = Math.max(1, Math.round(cssH * dpr));
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

// the glass of a screen; `breath` 0..1 is the running glow phase
export function screenBg(ctx, w, h, { bg = '#07090a', edge = 'rgba(120,200,255,0.10)', breath = 0, running = false } = {}) {
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  if (running) {
    const a = 0.08 + 0.06 * Math.sin(breath * Math.PI * 2);
    ctx.strokeStyle = edge.replace(/[\d.]+\)$/, a.toFixed(3) + ')');
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
  }
}
