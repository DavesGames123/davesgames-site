// ============================================================================
//  ALPHA QUDITS  ·  ends/draw.js  ·  2D canvas helpers for the ENDS figures
// ----------------------------------------------------------------------------
//  The colour language, text, arrows, the involute gear outline (imported
//  from pages/gear-types/teeth.js), the lock face and the matrix tile. All
//  sizes are CSS px; the caller scales the context by devicePixelRatio.
//
//  COLOURS (the same hex values as lib/sci.css .m1 to .m6)
//    qubit end ..... C.qubit  #62c4ff  (m1)
//    qutrit end .... C.qutrit #ff9a62  (m2)
//    a read ........ C.read   #86dc7c  (m3)
//    charge Q, Y ... C.charge #e889dc  (m4, as CORE's chapter text)
//    U, unbroken ... C.unbr   #f3b6ec  (a light m4)
//    highlight ..... C.accent #ffd666  (phases, arcs, the cap line)
//    third axis .... C.imag   #b9a3ff  (no symbol meaning)
//    dark type ..... C.dark   #ff6b78
//
//  GREP MAP   (grep -n "<anchor>" draw.js)
//    export const C ............ the colour tokens
//    export function font ...... a canvas font string (Inter / STIX Two Text)
//    export function label ..... text with an optional halo
//    export function arrow ..... a straight arrow
//    export function arcArrow .. an arc with an arrow head
//    export function gearPath .. a Path2D of an involute gear (cached)
//    export function drawGear .. a shaded gear with spokes and a hub
//    export function lockFace .. a pin-tumbler lock front with a turning plug
//    export function keyShape .. a key blade with a bitting profile
//    export function tile ...... one matrix entry cell, colour by value
//    export function ease ...... smoothstep and friends
// ============================================================================
import { outline } from '../../gear-types/teeth.js';

export const C = {
  bg: '#070b0e', panel: 'rgba(255,255,255,0.035)', line: 'rgba(200,220,230,0.16)',
  text: '#e8eef0', dim: '#93a2a8', faint: '#5d6b70',
  qubit: '#62c4ff', qutrit: '#ff9a62', read: '#86dc7c', charge: '#e889dc', accent: '#ffd666', imag: '#b9a3ff', unbr: '#f3b6ec', axle: '#c3ccd0',
  dark: '#ff6b78', ok: '#86dc7c', brass: '#d6b072', brassDark: '#7d6236', steel: '#b9c3c8',
};
export const SANS = "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
export const SERIF = "'STIX Two Text', 'Times New Roman', Georgia, serif";
export function font(px, w = 400, serif = false, italic = false) { return `${italic ? 'italic ' : ''}${w} ${Math.max(11, px).toFixed(1)}px ${serif ? SERIF : SANS}`; }

export const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
export const lerp = (a, b, t) => a + (b - a) * t;
export const ease = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
export const easeIO = t => { t = clamp(t, 0, 1); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
// a 0..1 pulse that rises over [a, a + r] and falls over [b - r, b]
export const window01 = (t, a, b, r = 0.12) => ease((t - a) / r) * (1 - ease((t - (b - r)) / r));

export function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
export function mix(h1, h2, t) {
  const a = parseInt(h1.slice(1), 16), b = parseInt(h2.slice(1), 16);
  const c = s => Math.round(lerp((a >> s) & 255, (b >> s) & 255, t));
  return `rgb(${c(16)},${c(8)},${c(0)})`;
}

export function label(g, s, x, y, o = {}) {
  g.save();
  g.font = o.font || font(13);
  g.textAlign = o.align || 'center';
  g.textBaseline = o.base || 'middle';
  if (o.halo !== false) { g.lineJoin = 'round'; g.lineWidth = o.haloW || 4; g.strokeStyle = o.haloC || 'rgba(7,11,14,0.85)'; g.strokeText(s, x, y); }
  g.fillStyle = o.color || C.text;
  g.globalAlpha *= o.alpha ?? 1;
  g.fillText(s, x, y);
  g.restore();
}
// Wrap text to a width; returns the lines.
export function wrap(g, s, w) {
  const out = []; let line = '';
  for (const word of String(s).split(/\s+/)) {
    const t = line ? line + ' ' + word : word;
    if (g.measureText(t).width > w && line) { out.push(line); line = word; } else line = t;
  }
  if (line) out.push(line);
  return out;
}

export function arrow(g, x0, y0, x1, y1, o = {}) {
  const h = o.head ?? 8, a = Math.atan2(y1 - y0, x1 - x0);
  g.save(); g.strokeStyle = g.fillStyle = o.color || C.text; g.lineWidth = o.w || 2; g.globalAlpha *= o.alpha ?? 1;
  g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1 - Math.cos(a) * h * 0.6, y1 - Math.sin(a) * h * 0.6); g.stroke();
  g.beginPath(); g.moveTo(x1, y1); g.lineTo(x1 - h * Math.cos(a - 0.42), y1 - h * Math.sin(a - 0.42)); g.lineTo(x1 - h * Math.cos(a + 0.42), y1 - h * Math.sin(a + 0.42)); g.closePath(); g.fill();
  g.restore();
}
// Arc around (cx, cy) of radius r from a0 to a1 (radians, canvas sense),
// with a head at a1.
export function arcArrow(g, cx, cy, r, a0, a1, o = {}) {
  if (Math.abs(a1 - a0) < 1e-3) return;
  const ccw = a1 < a0, h = o.head ?? 8;
  g.save(); g.strokeStyle = g.fillStyle = o.color || C.text; g.lineWidth = o.w || 2; g.globalAlpha *= o.alpha ?? 1;
  const back = Math.min(Math.abs(a1 - a0), h * 0.6 / r) * (ccw ? -1 : 1);
  g.beginPath(); g.arc(cx, cy, r, a0, a1 - back, ccw); g.stroke();
  const x = cx + r * Math.cos(a1), y = cy + r * Math.sin(a1), tan = a1 + (ccw ? -Math.PI / 2 : Math.PI / 2);
  g.beginPath(); g.moveTo(x, y);
  g.lineTo(x - h * Math.cos(tan - 0.42), y - h * Math.sin(tan - 0.42));
  g.lineTo(x - h * Math.cos(tan + 0.42), y - h * Math.sin(tan + 0.42));
  g.closePath(); g.fill(); g.restore();
}

// ---------------------------------------------------------------- gears
const gearCache = new Map();
// The involute outline of an N-tooth gear of pitch radius R, as a list of
// [x, y] in px around (0, 0), tooth 0 centred on angle 0.
export function gearPoints(N, R) {
  const key = N + ':' + R.toFixed(2);
  if (gearCache.has(key)) return gearCache.get(key);
  const m = 2 * R / N, pts = outline(N, N, m, { ha: 1, hf: 1.25, t: 0.48 }).map(([r, p]) => [r * Math.cos(p), r * Math.sin(p)]);
  gearCache.set(key, pts);
  if (gearCache.size > 40) gearCache.delete(gearCache.keys().next().value);
  return pts;
}
// A shaded gear at (x, y), turned by ang (radians, canvas sense).
// o: { N, R, color, spokes: [{ a, color, label }], alpha, ghost, hub }
export function drawGear(g, x, y, ang, o) {
  const N = o.N || 16, R = o.R, pts = gearPoints(N, R);
  g.save(); g.translate(x, y); g.rotate(ang); g.globalAlpha *= o.alpha ?? 1;
  g.beginPath();
  pts.forEach(([px, py], i) => i ? g.lineTo(px, py) : g.moveTo(px, py));
  g.closePath();
  if (o.ghost) {
    g.setLineDash([4, 4]); g.lineWidth = 1.5; g.strokeStyle = o.color; g.stroke(); g.setLineDash([]);
  } else {
    const gr = g.createRadialGradient(-R * 0.35, -R * 0.4, R * 0.1, 0, 0, R * 1.15);
    gr.addColorStop(0, mix(o.color, '#ffffff', 0.35)); gr.addColorStop(0.55, o.color); gr.addColorStop(1, mix(o.color, '#000000', 0.55));
    g.fillStyle = gr; g.fill();
    g.lineWidth = 1; g.strokeStyle = 'rgba(0,0,0,0.55)'; g.stroke();
    // web and lightening holes
    g.beginPath(); g.arc(0, 0, R * 0.74, 0, Math.PI * 2); g.strokeStyle = 'rgba(0,0,0,0.28)'; g.lineWidth = Math.max(1, R * 0.05); g.stroke();
    for (let k = 0; k < 5; k++) {
      const a = k * Math.PI * 2 / 5 + Math.PI / 5;
      g.beginPath(); g.arc(Math.cos(a) * R * 0.48, Math.sin(a) * R * 0.48, R * 0.13, 0, Math.PI * 2);
      g.fillStyle = 'rgba(0,0,0,0.42)'; g.fill();
    }
  }
  // spokes: the basis directions written on the gear
  for (const s of o.spokes || []) {
    const ca = Math.cos(s.a), sa = Math.sin(s.a), r0 = R * 0.2, r1 = R * 0.86;
    g.lineCap = 'round';
    g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 6; g.beginPath(); g.moveTo(ca * r0, sa * r0); g.lineTo(ca * r1, sa * r1); g.stroke();
    g.strokeStyle = s.color; g.lineWidth = 3.2; g.beginPath(); g.moveTo(ca * r0, sa * r0); g.lineTo(ca * r1, sa * r1); g.stroke();
    g.beginPath(); g.arc(ca * r1, sa * r1, 4.2, 0, Math.PI * 2); g.fillStyle = s.color; g.fill();
  }
  // hub
  g.beginPath(); g.arc(0, 0, R * 0.17, 0, Math.PI * 2); g.fillStyle = '#20282c'; g.fill();
  g.lineWidth = 1.5; g.strokeStyle = 'rgba(255,255,255,0.25)'; g.stroke();
  if (o.axle) { g.beginPath(); g.arc(0, 0, R * 0.09, 0, Math.PI * 2); g.fillStyle = o.axle; g.fill(); }
  g.restore();
}

// ---------------------------------------------------------------- locks
// A pin-tumbler lock seen from the front: brass shell, the plug with a
// keyway, turned by ang. state: 'open' | 'dark' | 'idle'. glow 0..1.
export function lockFace(g, x, y, r, ang, o = {}) {
  g.save(); g.translate(x, y);
  const shell = o.dim ? '#3a3326' : C.brass;
  // shell
  const gr = g.createRadialGradient(-r * 0.4, -r * 0.5, r * 0.1, 0, 0, r * 1.2);
  gr.addColorStop(0, mix(shell, '#ffffff', 0.25)); gr.addColorStop(1, mix(shell, '#000000', 0.5));
  g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fillStyle = gr; g.fill();
  if (o.glow) { g.lineWidth = 3; g.strokeStyle = rgba(o.glowColor || C.ok, 0.25 + 0.6 * o.glow); g.stroke(); }
  // plug
  g.rotate(ang);
  g.beginPath(); g.arc(0, 0, r * 0.62, 0, Math.PI * 2);
  g.fillStyle = o.dim ? '#2c2a24' : mix(C.brass, '#ffffff', 0.12); g.fill();
  g.lineWidth = 1.2; g.strokeStyle = 'rgba(0,0,0,0.5)'; g.stroke();
  // keyway: a vertical slot with a step, as a warded keyway
  const kw = r * 0.13, kh = r * 0.42;
  g.beginPath();
  g.moveTo(-kw, -kh); g.lineTo(kw * 0.4, -kh); g.lineTo(kw * 0.4, -kh * 0.2); g.lineTo(kw, -kh * 0.05);
  g.lineTo(kw, kh); g.lineTo(-kw * 0.4, kh); g.lineTo(-kw * 0.4, kh * 0.3); g.lineTo(-kw, kh * 0.15); g.closePath();
  g.fillStyle = '#0b0d0e'; g.fill();
  g.restore();
  // pin chambers at the top of the shell (fixed)
  g.save(); g.translate(x, y);
  for (let k = -1; k <= 1; k++) {
    g.beginPath(); g.arc(k * r * 0.3, -r * 0.8, r * 0.07, 0, Math.PI * 2); g.fillStyle = 'rgba(0,0,0,0.45)'; g.fill();
  }
  g.restore();
}
// A key blade from (x, y) pointing right, length L, height h, with a
// bitting profile (list of depths 0..1); colour.
export function keyShape(g, x, y, L, h, cuts, o = {}) {
  g.save(); g.translate(x, y); g.globalAlpha *= o.alpha ?? 1;
  const bow = h * 1.25;
  g.beginPath(); g.arc(-bow * 0.9, 0, bow, 0, Math.PI * 2);
  g.moveTo(-bow * 0.9 + bow * 0.38, 0); g.arc(-bow * 0.9, 0, bow * 0.38, 0, Math.PI * 2, true);
  g.fillStyle = o.color || C.steel; g.fill('evenodd');
  g.beginPath(); g.moveTo(0, -h / 2);
  const n = cuts.length;
  for (let i = 0; i < n; i++) {
    const x0 = (i + 0.15) / n * L, x1 = (i + 0.5) / n * L, x2 = (i + 0.85) / n * L, d = h * 0.55 * cuts[i];
    g.lineTo(x0, -h / 2); g.lineTo(x1, -h / 2 + d); g.lineTo(x2, -h / 2);
  }
  g.lineTo(L, -h / 2); g.lineTo(L + h * 0.4, 0); g.lineTo(L, h / 2); g.lineTo(0, h / 2); g.closePath();
  g.fill();
  g.lineWidth = 1; g.strokeStyle = 'rgba(0,0,0,0.45)'; g.stroke();
  g.restore();
}

// ---------------------------------------------------------------- tiles
// One matrix cell at (x, y), size s, for a complex value (re, im) with a
// scale vmax. Fill by the larger part: real + pale blue, real - pale
// orange, imaginary + pale yellow, imaginary - pale violet. The colours are
// lighter than the end colours so a tile does not read as an end.
export function tile(g, x, y, s, re, im, vmax = 1, o = {}) {
  g.save();
  g.fillStyle = 'rgba(255,255,255,0.04)'; g.fillRect(x, y, s, s);
  const m = Math.hypot(re, im) / vmax;
  if (m > 1e-6) {
    const a = clamp(m, 0, 1);
    const col = Math.abs(im) > Math.abs(re) ? (im > 0 ? '#ffe08a' : '#c4b5ff') : (re > 0 ? '#a6e1ff' : '#ffbd96');
    const inset = s * (1 - Math.sqrt(a)) / 2;
    g.fillStyle = rgba(col, 0.25 + 0.7 * a); g.fillRect(x + inset, y + inset, s - 2 * inset, s - 2 * inset);
    if (o.text && s >= 22) {
      label(g, o.text, x + s / 2, y + s / 2 + 0.5, { font: font(Math.min(13, s * 0.36), 600), color: '#0b0f12', halo: false });
    }
  }
  g.lineWidth = 1; g.strokeStyle = o.stroke || 'rgba(255,255,255,0.10)'; g.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1);
  g.restore();
}
// A rounded rectangle path.
export function rrect(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
// Short number text: 0.707 -> ".71", 1 -> "1", -0.5 -> "-.5".
export function short(v, dp = 2) {
  if (Math.abs(v) < 5e-4) return '0';
  let s = v.toFixed(dp).replace(/0+$/, '').replace(/\.$/, '');
  return s.replace(/^(-?)0\./, '$1.');
}
