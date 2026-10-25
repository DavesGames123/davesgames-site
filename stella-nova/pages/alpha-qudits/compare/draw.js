// ============================================================================
//  ALPHA QUDITS  ·  compare/draw.js  ·  canvas helpers for COMPARE (DOM-free)
// ----------------------------------------------------------------------------
//  The palette follows lib/sci.css and the page tokens of style.css: m1
//  qubit, m2 qutrit, m3 records, m4 charge, m5 alpha and its value (gold),
//  m6 readout N. Every helper takes a 2D context and plain numbers, so the
//  scenes draw the same way in the page, in the saver and in node tests.
//
//  grep -n targets:  export const C | export const FONT | export function text |
//  export function wavyPts | export function niceStep | export function ease
// ============================================================================

export const C = {
  bg: '#06080d', card: '#0c1018', card2: '#111725', well: '#04060a',
  ink: '#eceef3', ink2: '#c4c9d6', dim: '#8b93a7', faint: '#3a4256',
  line: 'rgba(255,255,255,0.075)', line2: 'rgba(255,255,255,0.15)', grid: 'rgba(255,255,255,0.06)',
  qb: '#62c4ff', qt: '#ff9a62', rec: '#86dc7c', chg: '#e889dc', val: '#ffd666', ro: '#a8a4ff',
  bad: '#ff7a7a',
};
export const FAM = {
  sans: "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  serif: "'STIX Two Text', Georgia, 'Times New Roman', serif",
  mono: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
};
export const FONT = (px, { w = 400, fam = 'sans', it = false } = {}) => `${it ? 'italic ' : ''}${w} ${px}px ${FAM[fam] || fam}`;

export const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
export const lerp = (a, b, k) => a + (b - a) * k;
export const ease = k => { k = clamp(k); return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; };
export const easeOut = k => 1 - Math.pow(1 - clamp(k), 3);

// Colour with alpha: hex '#rrggbb' -> 'rgba(r,g,b,a)'.
export function rgba(hex, a) {
  if (!hex || hex[0] !== '#') return hex;
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// Text with options. Returns the drawn width.
export function text(g, s, x, y, o = {}) {
  g.font = FONT(o.size || 12, { w: o.w || 400, fam: o.fam || 'sans', it: !!o.it });
  g.fillStyle = o.color || C.ink2;
  g.textAlign = o.align || 'left';
  g.textBaseline = o.base || 'alphabetic';
  if (o.alpha != null) g.globalAlpha = o.alpha;
  g.fillText(String(s), x, y);
  const w = g.measureText(String(s)).width;
  if (o.alpha != null) g.globalAlpha = 1;
  return w;
}
export function measure(g, s, o = {}) {
  g.font = FONT(o.size || 12, { w: o.w || 400, fam: o.fam || 'sans', it: !!o.it });
  return g.measureText(String(s)).width;
}
// Shrink a font size until the text fits in maxW (down to min px).
export function fitSize(g, s, maxW, size, o = {}, min = 11) {
  let px = size;
  while (px > min && measure(g, s, { ...o, size: px }) > maxW) px -= 0.5;
  return px;
}

export function roundRect(g, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath();
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}
export function line(g, x0, y0, x1, y1, color, w = 1, dash = null) {
  g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1);
  g.strokeStyle = color; g.lineWidth = w; g.setLineDash(dash || []); g.stroke(); g.setLineDash([]);
}
export function dot(g, x, y, r, fill, stroke = null, lw = 1.5) {
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2);
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw; g.stroke(); }
}
export function strokePts(g, pts, color, w = 1.6, dash = null) {
  if (!pts.length) return;
  g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  g.strokeStyle = color; g.lineWidth = w; g.setLineDash(dash || []); g.lineJoin = 'round'; g.lineCap = 'round'; g.stroke(); g.setLineDash([]);
}

// A photon line, the way the particle-collider Feynman card draws it (our
// own copy of the idea: a sine about the segment). phase moves the wave.
export function wavyPts(x0, y0, x1, y1, amp = 4, wl = 11, phase = 0) {
  const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
  const k = Math.max(2, Math.round(L / wl)), n = k * 12, pts = [];
  for (let i = 0; i <= n; i++) {
    const s = i / n, env = Math.min(1, s * k * 1.5, (1 - s) * k * 1.5);
    const o = amp * env * Math.sin(2 * Math.PI * k * s - phase);
    pts.push([x0 + dx * s + nx * o, y0 + dy * s + ny * o]);
  }
  return pts;
}
// Arrow head at (x, y) pointing along (dx, dy).
export function arrow(g, x, y, dx, dy, s, color) {
  const L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
  g.beginPath();
  g.moveTo(x + ux * s, y + uy * s);
  g.lineTo(x - ux * s + nx * s * 0.8, y - uy * s + ny * s * 0.8);
  g.lineTo(x - ux * s - nx * s * 0.8, y - uy * s - ny * s * 0.8);
  g.closePath(); g.fillStyle = color; g.fill();
}

// A nice tick step for a span and a wanted number of ticks.
export function niceStep(span, n = 5) {
  const raw = span / Math.max(1, n), e = Math.floor(Math.log10(raw)), f = raw / 10 ** e;
  const m = f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10;
  return m * 10 ** e;
}
// Ticks in [lo, hi] at multiples of step, without float drift.
export function ticks(lo, hi, step) {
  const out = [], k0 = Math.ceil(lo / step - 1e-9), k1 = Math.floor(hi / step + 1e-9);
  for (let k = k0; k <= k1 && out.length < 200; k++) out.push(k * step);
  return out;
}

// Fill the box with the figure background (the card colour, a soft glow).
export function backdrop(g, box, glow = C.val, a = 0.05) {
  g.clearRect(box.x, box.y, box.w, box.h);
  const gr = g.createRadialGradient(box.x + box.w / 2, box.y + box.h * 0.2, 0, box.x + box.w / 2, box.y + box.h * 0.2, Math.max(box.w, box.h) * 0.8);
  gr.addColorStop(0, rgba(glow, a)); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(box.x, box.y, box.w, box.h);
}

// A tiny deterministic random source (mulberry32).
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Text with TeX-like sub- and superscripts: 'α_{bare}', 'tr_R', 'Z_3'.
// One level only; a script is 72% size and shifted. Returns the width.
export function textTex(g, s, x, y, o = {}) {
  const size = o.size || 12, parts = [];
  const re = /([_^])(\{([^}]*)\}|(.))/g;
  let last = 0, m;
  while ((m = re.exec(s))) {
    if (m.index > last) parts.push({ t: s.slice(last, m.index), k: 0 });
    parts.push({ t: m[3] ?? m[4], k: m[1] === '_' ? 1 : -1 });
    last = re.lastIndex;
  }
  if (last < s.length) parts.push({ t: s.slice(last), k: 0 });
  const align = o.align || 'left';
  const widthOf = p => measure(g, p.t, { ...o, size: p.k ? Math.max(11, size * 0.72) : size });
  const total = parts.reduce((w, p) => w + widthOf(p), 0);
  let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  for (const p of parts) {
    const sz = p.k ? Math.max(11, size * 0.72) : size;   // scripts stay legible (11 px floor)
    const w = text(g, p.t, cx, y + (p.k === 1 ? size * 0.28 : p.k === -1 ? -size * 0.38 : 0), { ...o, size: sz, align: 'left' });
    cx += w;
  }
  return total;
}
