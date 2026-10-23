// ============================================================================
//  OCTANE NUMBER  ·  draw.js — the 2D canvas figures (no DOM lookups)
// ----------------------------------------------------------------------------
//  Each function draws one figure into a 2D context g of CSS size w x h.
//  The page (main.js) and the saver (saver.js) both call them. A function
//  that can be clicked returns its hit boxes.
//
//  PAL is the palette of style.css (--c-hep, --c-iso, --c-knock ...).
//
//  grep -n targets
//    chart frame ........... "function chart("
//    blend glass ........... "export function drawBlend"
//    knock meter ........... "export function drawMeter"
//    cylinder .............. "export function drawCylinder"
//    pressure trace ........ "export function drawPressure"
//    octane needed ......... "export function drawRequired"
//    spark sweep ........... "export function drawSpark"
//    ladder ................ "export function drawLadder"
//    reaction steps ........ "export function drawMech"
//    shift count ........... "export function drawShift"
//    RON against MON ....... "export function drawRonMon"
// ============================================================================
import { FAMILY } from './data.js';

export const PAL = {
  hep: '#ff7a59', iso: '#62c4ff', knock: '#ff4d5e', flame: '#ffb347', end: '#7fb8ff', integ: '#86dc7c',
  ink: '#e8eaf0', ink2: '#c2c7d4', dim: '#8a91a5', faint: '#394155', grid: 'rgba(255,255,255,0.07)', bg: '#05070d',
  C: '#9aa3b2', H: '#e9edf2', O: '#ff5a4a',
};
export const FONT = (px, w = 400) => `${w} ${px}px Inter, system-ui, -apple-system, sans-serif`;
const MONO = px => `${px}px ui-monospace, 'SF Mono', Menlo, monospace`;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = k => { k = clamp(k, 0, 1); return k * k * (3 - 2 * k); };
function mix(c1, c2, t) {
  const p = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
  const a = p(c1), b = p(c2);
  return `rgb(${a.map((v, i) => Math.round(lerp(v, b[i], clamp(t, 0, 1)))).join(',')})`;
}
function rgba(c, a) { const p = [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16)); return `rgba(${p.join(',')},${a})`; }
// Seeded random numbers (mulberry32).
export function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---------------------------------------------------------------- chart frame
// Axes, grid and labels. Returns { X, Y, l, r, t, b }.
function ticks(a, b, n) {
  const step0 = (b - a) / n, mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= step0) || 10 * mag;
  const out = []; for (let v = Math.ceil(a / step) * step; v <= b + 1e-9; v += step) out.push(+v.toFixed(6));
  return out;
}
function chart(g, w, h, o) {
  const fs = o.fs || 11;
  const l = o.l ?? 46, r = o.r ?? 14, t = o.t ?? 12, b = o.b ?? 36;
  const X = v => l + (v - o.x[0]) / (o.x[1] - o.x[0]) * (w - l - r);
  const Y = v => h - b - (v - o.y[0]) / (o.y[1] - o.y[0]) * (h - t - b);
  g.font = FONT(fs); g.lineWidth = 1;
  for (const v of o.xt || ticks(o.x[0], o.x[1], Math.max(3, Math.round((w - l - r) / 70)))) {
    g.strokeStyle = PAL.grid; g.beginPath(); g.moveTo(X(v), t); g.lineTo(X(v), h - b); g.stroke();
    g.fillStyle = PAL.dim; g.textAlign = 'center'; g.textBaseline = 'top'; g.fillText(o.xf ? o.xf(v) : String(v), X(v), h - b + 5);
  }
  for (const v of o.yt || ticks(o.y[0], o.y[1], Math.max(3, Math.round((h - t - b) / 48)))) {
    g.strokeStyle = PAL.grid; g.beginPath(); g.moveTo(l, Y(v)); g.lineTo(w - r, Y(v)); g.stroke();
    g.fillStyle = PAL.dim; g.textAlign = 'right'; g.textBaseline = 'middle'; g.fillText(o.yf ? o.yf(v) : String(v), l - 6, Y(v));
  }
  g.fillStyle = PAL.ink2; g.font = FONT(fs);
  if (o.xl) { g.textAlign = 'center'; g.textBaseline = 'bottom'; g.fillText(o.xl, (l + w - r) / 2, h - 2); }
  if (o.yl) { g.save(); g.translate(11, (t + h - b) / 2); g.rotate(-Math.PI / 2); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(o.yl, 0, 0); g.restore(); }
  return { X, Y, l, r: w - r, t, b: h - b };
}
function poly(g, pts, X, Y) { g.beginPath(); pts.forEach(([x, y], i) => i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y))); }

// ---------------------------------------------------------------- skeletons
// Skeletal formulas in bond-length units (zigzag at 30°), centred.
const ZX = Math.cos(Math.PI / 6), ZY = 0.5;
function centre(pts) { const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cy = pts.reduce((s, p) => s + p[1], 0) / pts.length; return pts.map(([x, y]) => [x - cx, y - cy]); }
export const SKEL = {
  heptane: { atoms: centre(Array.from({ length: 7 }, (_, i) => [i * ZX, (i % 2) * ZY])), bonds: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6]] },
  // 2,2,4-trimethylpentane: C1..C5 zigzag, two methyls on C2, one on C4
  isooctane: { atoms: centre([[0, 0], [ZX, ZY], [2 * ZX, 0], [3 * ZX, ZY], [4 * ZX, 0], [ZX - 0.5, ZY + ZX], [ZX + 0.5, ZY + ZX], [3 * ZX, ZY + 1]]), bonds: [[0, 1], [1, 2], [2, 3], [3, 4], [1, 5], [1, 6], [3, 7]] },
};
function drawSkel(g, sk, x, y, s, rot, color, lw) {
  const c = Math.cos(rot), si = Math.sin(rot);
  const P = sk.atoms.map(([u, v]) => [x + s * (u * c - v * si), y + s * (u * si + v * c)]);
  g.strokeStyle = color; g.lineWidth = lw; g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath();
  for (const [a, b] of sk.bonds) { g.moveTo(P[a][0], P[a][1]); g.lineTo(P[b][0], P[b][1]); }
  g.stroke();
}

// ---------------------------------------------------------------- blend
// A glass of reference fuel. frac 0..1 iso-octane; t seconds.
const BLEND_N = 54;
const BLEND = (() => {
  const r = rng(27), ps = [];
  for (let k = 0; k < BLEND_N; k++) ps.push({ x: r(), y: r(), ph: r() * 6.283, sp: 0.4 + r() * 0.6, rot: r() * 6.283, vr: (r() - 0.5) * 0.6, rank: 0 });
  const order = ps.map((_, i) => i).sort(() => r() - 0.5);
  order.forEach((i, k) => { ps[i].rank = k; });
  return ps;
})();
export function drawBlend(g, w, h, { frac, t = 0, fs = 11 }) {
  const gw = Math.min(w * 0.72, h * 1.25), gh = h * 0.84, gx = (w - gw) / 2, gy = h * 0.08;
  const lvl = gy + gh * 0.14;
  // glass
  g.save();
  const r = 18;
  g.beginPath(); g.moveTo(gx, gy); g.lineTo(gx, gy + gh - r); g.quadraticCurveTo(gx, gy + gh, gx + r, gy + gh); g.lineTo(gx + gw - r, gy + gh); g.quadraticCurveTo(gx + gw, gy + gh, gx + gw, gy + gh - r); g.lineTo(gx + gw, gy);
  const glass = new Path2D(); glass.rect(gx, lvl, gw, gy + gh - lvl);
  g.save(); g.clip(glass);
  const lg = g.createLinearGradient(0, lvl, 0, gy + gh);
  const tint = mix(PAL.hep, PAL.iso, frac);
  lg.addColorStop(0, rgba('#ffd9a0', 0.10)); lg.addColorStop(1, 'rgba(255,190,110,0.03)');
  g.fillStyle = lg; g.fillRect(gx, lvl, gw, gy + gh - lvl);
  // molecules
  const nIso = Math.round(frac * BLEND_N);
  const s = clamp(gw / 18, 7, 15);
  for (const p of BLEND) {
    const iso = p.rank < nIso;
    const x = gx + 12 + (gw - 24) * ((p.x + 0.035 * Math.sin(t * p.sp + p.ph)) % 1 + 1) % 1;
    const y = lvl + 14 + (gy + gh - lvl - 28) * ((p.y + 0.03 * Math.cos(t * p.sp * 0.8 + p.ph)) % 1 + 1) % 1;
    drawSkel(g, iso ? SKEL.isooctane : SKEL.heptane, x, y, s, p.rot + t * p.vr, iso ? PAL.iso : PAL.hep, iso ? 2.1 : 1.9);
  }
  g.restore();
  // meniscus and walls
  g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = 1; g.beginPath(); g.moveTo(gx + 2, lvl); g.quadraticCurveTo(gx + gw / 2, lvl + 5, gx + gw - 2, lvl); g.stroke();
  g.strokeStyle = 'rgba(220,230,255,0.38)'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(gx, gy); g.lineTo(gx, gy + gh - r); g.quadraticCurveTo(gx, gy + gh, gx + r, gy + gh); g.lineTo(gx + gw - r, gy + gh); g.quadraticCurveTo(gx + gw, gy + gh, gx + gw, gy + gh - r); g.lineTo(gx + gw, gy); g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(gx + 6, gy + 6, 5, gh - 24);
  // graduations
  g.fillStyle = PAL.dim; g.font = FONT(fs - 1); g.textAlign = 'left'; g.textBaseline = 'middle';
  for (let k = 0; k <= 4; k++) { const y = gy + gh - (gy + gh - lvl) * k / 4; g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(gx + gw - 14, y, 10, 1); }
  // label
  const on = frac * 100;
  g.font = FONT(Math.round(fs * 2.6)); g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  g.fillStyle = tint; g.fillText(on.toFixed(on % 1 ? 1 : 0), w / 2, gy + gh * 0.11);
  g.font = FONT(fs); g.fillStyle = PAL.ink2; g.fillText('octane', w / 2, gy + gh * 0.11 + fs + 3);
  g.restore();
}

// ---------------------------------------------------------------- meter
// Critical compression ratio of a sample and of the reference blend.
export function drawMeter(g, w, h, { sample, blend, fs = 11 }) {
  const C = chart(g, w, h, { x: [2, 12], y: [0, 2], l: 92, r: 18, t: 16, b: 34, yt: [], xl: 'compression ratio at standard knock (model)', fs });
  const rows = [[sample.name, sample.ccr, PAL.ink], [`blend ${blend.on.toFixed(1)} % iso-octane`, blend.ccr, mix(PAL.hep, PAL.iso, blend.on / 100)]];
  rows.forEach(([name, v, col], i) => {
    const y = C.Y(1.45 - i * 0.9), bh = Math.min(26, (C.b - C.t) / 4);
    g.fillStyle = PAL.ink2; g.font = FONT(fs); g.textAlign = 'right'; g.textBaseline = 'middle';
    const lines = name.length > 14 ? [name.slice(0, name.lastIndexOf(' ', 14) > 0 ? name.lastIndexOf(' ', 14) : 14), name.slice(name.lastIndexOf(' ', 14) > 0 ? name.lastIndexOf(' ', 14) + 1 : 14)] : [name];
    lines.forEach((s, k) => g.fillText(s, C.l - 8, y + (k - (lines.length - 1) / 2) * (fs + 2)));
    g.fillStyle = 'rgba(255,255,255,0.04)'; g.fillRect(C.l, y - bh / 2, C.r - C.l, bh);
    if (v != null) {
      g.fillStyle = col; g.fillRect(C.l, y - bh / 2, C.X(clamp(v, 2, 12)) - C.l, bh);
      g.fillStyle = '#05070d'; g.font = MONO(fs); g.textAlign = 'right';
      if (C.X(v) - C.l > 44) g.fillText(v.toFixed(2), C.X(clamp(v, 2, 12)) - 5, y);
    }
  });
  if (sample.ccr != null && blend.ccr != null && Math.abs(sample.ccr - blend.ccr) < 0.04) {
    g.strokeStyle = '#9de8b6'; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(C.X(sample.ccr), C.t); g.lineTo(C.X(sample.ccr), C.b); g.stroke(); g.setLineDash([]);
  }
}

// ---------------------------------------------------------------- cylinder
// Area share of a circle of radius R centred at (cx, top) inside the
// chamber rect [x0, x1] x [top, bot] (numeric, by columns).
function circleShare(R, cx, x0, x1, top, bot) {
  const n = 48, dx = (x1 - x0) / n; let a = 0;
  for (let k = 0; k < n; k++) { const x = x0 + (k + 0.5) * dx, d = R * R - (x - cx) * (x - cx); if (d > 0) a += Math.min(Math.sqrt(d), bot - top) * dx; }
  return a / ((x1 - x0) * (bot - top));
}
// c: a knock.js cycle; th: crank angle; E: engine; drop(th) piston drop.
export function drawCylinder(g, w, h, { c, th, E, drop, fs = 11, labels = true, wall = 0 }) {
  g.fillStyle = PAL.bg; g.fillRect(0, 0, w, h);
  const strokePx = Math.min(h * 0.46, w * 0.62);
  const scale = strokePx / E.stroke;
  const bore = E.bore * scale, cx = w / 2;
  const clearance = (E.stroke / (c.opts.cr - 1)) * scale;   // height of the clearance volume
  const headY = Math.max(h * 0.17, 60), x0 = cx - bore / 2, x1 = cx + bore / 2;
  const pTop = headY + clearance + drop(th) * scale;
  const i = clamp(Math.round(th - c.th[0]), 0, c.th.length - 1);
  const xb = c.xb[i], I = c.I[i], spark = -c.opts.spark;
  const knocked = c.knock && th >= c.knock.th;
  // cylinder walls and coolant
  g.fillStyle = '#1a2030'; g.fillRect(x0 - 16, headY - 4, 16, h - headY); g.fillRect(x1, headY - 4, 16, h - headY);
  g.fillStyle = '#0c1220'; g.fillRect(x0 - 26, headY - 4, 10, h - headY); g.fillRect(x1 + 16, headY - 4, 10, h - headY);
  // head
  g.fillStyle = '#232a3a'; g.fillRect(x0 - 26, headY - 30, bore + 52, 30);
  // valves (closed)
  g.fillStyle = '#3a4255';
  for (const vx of [x0 + bore * 0.2, x1 - bore * 0.2]) { g.fillRect(vx - 3, headY - 30, 6, 26); g.fillRect(vx - bore * 0.13, headY - 6, bore * 0.26, 4); }
  // chamber gas
  const chamberH = Math.max(1, pTop - headY);
  const ug = 0.18 + 0.5 * clamp((c.Tu[i] - 320) / 600, 0, 1);
  const endCol = I < 1 ? mix('#2a4a7a', '#ffb070', clamp(I, 0, 1) ** 1.5) : '#ffd2a0';
  g.save(); g.beginPath(); g.rect(x0, headY, bore, chamberH); g.clip();
  g.fillStyle = endCol; g.globalAlpha = 0.35 + ug; g.fillRect(x0, headY, bore, chamberH); g.globalAlpha = 1;
  // flame
  if (xb > 0 && th >= spark) {
    const rho = 3.6, yb = xb * rho / (1 + xb * (rho - 1));
    let lo = 0, hi = Math.hypot(bore, chamberH) * 1.05;
    for (let k = 0; k < 22; k++) { const m = (lo + hi) / 2; if (circleShare(m, cx, x0, x1, headY, headY + chamberH) < yb) lo = m; else hi = m; }
    const R = lo;
    const fadeHot = clamp(1 - (th - spark - E.burn) / 80, 0.25, 1);
    const fg = g.createRadialGradient(cx, headY, 0, cx, headY, Math.max(R, 1));
    fg.addColorStop(0, rgba('#ff9a3c', 0.55 * fadeHot)); fg.addColorStop(0.85, rgba('#ffb347', 0.75 * fadeHot)); fg.addColorStop(1, rgba('#fff1c4', 0.95 * fadeHot));
    g.fillStyle = fg; g.beginPath(); g.arc(cx, headY, R, 0, Math.PI); g.fill();
    if (xb < 0.995) { g.strokeStyle = rgba('#fff4d6', 0.9 * fadeHot); g.lineWidth = 2; g.beginPath(); g.arc(cx, headY, R, 0, Math.PI); g.stroke(); }
  }
  // knock: hot spots in the end gas and pressure waves
  if (knocked) {
    const dt = th - c.knock.th, a = Math.exp(-dt / 18);
    const r = rng(91), spots = [[x0 + bore * 0.08, headY + chamberH * 0.7], [x1 - bore * 0.1, headY + chamberH * 0.6], [x0 + bore * 0.15, headY + chamberH * 0.2], [x1 - bore * 0.05, headY + chamberH * 0.15]];
    for (const [sx, sy] of spots) {
      const rr = (dt * 0.9 + 3) * (bore / 80) * (0.8 + r() * 0.4);
      const kg = g.createRadialGradient(sx, sy, 0, sx, sy, rr * 2.2);
      kg.addColorStop(0, rgba('#ffffff', 0.95 * a)); kg.addColorStop(0.3, rgba('#ff4d5e', 0.75 * a)); kg.addColorStop(1, rgba('#ff4d5e', 0));
      g.fillStyle = kg; g.beginPath(); g.arc(sx, sy, rr * 2.2, 0, 7); g.fill();
    }
    for (let k = 0; k < 4; k++) {
      const ph = (dt * 1.6 + k * 9) % 36;
      g.strokeStyle = rgba('#ff8a95', 0.6 * a * (1 - ph / 36)); g.lineWidth = 1.5;
      g.beginPath(); g.ellipse(cx, headY + chamberH / 2, bore * (0.1 + ph / 40), chamberH * (0.1 + ph / 40), 0, 0, 7); g.stroke();
    }
  }
  g.restore();
  // spark plug and spark
  g.fillStyle = '#c9cfdb'; g.fillRect(cx - 4, headY - 40, 8, 34); g.fillStyle = '#e8ecf3'; g.fillRect(cx - 7, headY - 52, 14, 14);
  g.fillStyle = '#9aa3b2'; g.fillRect(cx - 1.5, headY - 6, 3, 6);
  if (th >= spark && th < spark + 4) {
    const k = 1 - (th - spark) / 4;
    const sg = g.createRadialGradient(cx, headY + 2, 0, cx, headY + 2, 26 * k + 4);
    sg.addColorStop(0, rgba('#ffffff', k)); sg.addColorStop(0.4, rgba('#bcd7ff', 0.6 * k)); sg.addColorStop(1, rgba('#7fb8ff', 0));
    g.fillStyle = sg; g.beginPath(); g.arc(cx, headY + 2, 30, 0, 7); g.fill();
  }
  // piston and rod
  const pg = g.createLinearGradient(x0, 0, x1, 0);
  pg.addColorStop(0, '#5a6274'); pg.addColorStop(0.5, '#a3abba'); pg.addColorStop(1, '#4c5466');
  g.fillStyle = pg; g.fillRect(x0 + 1, pTop, bore - 2, Math.min(bore * 0.55, h - pTop));
  g.fillStyle = '#2b3242'; for (let k = 0; k < 3; k++) g.fillRect(x0 + 1, pTop + 6 + k * 6, bore - 2, 2);
  if (knocked && c.knock.unburned > 0.08) {
    g.fillStyle = rgba('#ff4d5e', 0.35); g.fillRect(x0 + 1, pTop, bore - 2, 3);
  }
  const pinOff = bore * 0.36, pin = pTop + pinOff, crankY = headY + clearance + pinOff + (E.stroke / 2 + E.rod) * scale;
  const ang = th * Math.PI / 180, crX = cx + Math.sin(ang) * E.stroke / 2 * scale, crY = crankY - Math.cos(ang) * E.stroke / 2 * scale;
  g.strokeStyle = '#7d8699'; g.lineWidth = Math.max(5, bore * 0.09); g.lineCap = 'round';
  g.beginPath(); g.moveTo(cx, pin); g.lineTo(crX, crY); g.stroke();
  g.lineCap = 'butt';
  // labels: the crank angle top left, the gas zones inside the chamber
  g.font = FONT(fs, 500); g.textBaseline = 'top'; g.textAlign = 'left';
  g.fillStyle = PAL.ink; g.fillText(`${th > 0 ? '+' : ''}${Math.round(th)}°`, 8, 8);
  g.fillStyle = PAL.dim; g.font = FONT(fs - 1);
  g.fillText(th < 0 ? 'before top centre' : th > 0 ? 'after top centre' : 'top centre', 8, 10 + fs);
  if (labels && chamberH > 2.4 * fs) {
    g.font = FONT(fs - 1, 500); g.textBaseline = 'bottom';
    if (knocked) { g.fillStyle = '#fff'; g.textAlign = 'center'; g.fillText('knock', cx, headY + chamberH - 3); }
    else if (xb > 0.01 && xb < 0.9) { g.fillStyle = '#d6e6ff'; g.textAlign = 'left'; g.fillText('end gas', x0 + 4, headY + chamberH - 3); }
    else if (th < spark) { g.fillStyle = '#d6e6ff'; g.textAlign = 'center'; g.fillText('fuel + air', cx, headY + chamberH - 3); }
  }
  return { headY, pTop, x0, x1 };
}

// ---------------------------------------------------------------- pressure
export function drawPressure(g, w, h, { c, th, pressureAt, fs = 11, x = [-60, 90], showI = true, k = 1 }) {
  const pmax = Math.max(60, Math.ceil(c.pmax / 1e5 / 20) * 20 + (c.knock ? c.knock.intensity * 0.8 : 0));
  const C = chart(g, w, h, { x, y: [0, pmax], xl: 'crank angle, degrees from top centre', yl: 'pressure, bar', r: showI ? 34 : 14, fs, xf: v => (v > 0 ? '+' : '') + v });
  const xEnd = lerp(x[0], x[1], k);
  // spark
  const s = -c.opts.spark;
  if (s >= x[0]) { g.strokeStyle = rgba(PAL.end, 0.6); g.setLineDash([3, 4]); g.beginPath(); g.moveTo(C.X(s), C.t); g.lineTo(C.X(s), C.b); g.stroke(); g.setLineDash([]); g.fillStyle = PAL.end; g.font = FONT(fs - 1); g.textAlign = 'left'; g.textBaseline = 'top'; g.fillText('spark', C.X(s) + 3, C.t + 2); }
  // burned share (right axis 0..1), the knock integral
  if (showI) {
    const Yr = v => C.b - v * (C.b - C.t);
    g.fillStyle = PAL.dim; g.font = FONT(fs - 1); g.textAlign = 'left'; g.textBaseline = 'middle';
    for (const v of [0, 0.5, 1]) g.fillText(v.toFixed(1), C.r + 4, Yr(v));
    g.lineWidth = 1.5;
    g.strokeStyle = rgba(PAL.flame, 0.65); g.beginPath();
    for (let t = x[0]; t <= xEnd; t += 1) { const i = clamp(Math.round(t - c.th[0]), 0, c.th.length - 1); const y = Yr(c.xb[i]); t === x[0] ? g.moveTo(C.X(t), y) : g.lineTo(C.X(t), y); }
    g.stroke();
    g.strokeStyle = PAL.integ; g.setLineDash([5, 3]); g.beginPath();
    for (let t = x[0]; t <= xEnd; t += 1) { const i = clamp(Math.round(t - c.th[0]), 0, c.th.length - 1); const y = Yr(Math.min(1, c.I[i])); t === x[0] ? g.moveTo(C.X(t), y) : g.lineTo(C.X(t), y); }
    g.stroke(); g.setLineDash([]);
    g.strokeStyle = rgba(PAL.integ, 0.3); g.beginPath(); g.moveTo(C.l, Yr(1)); g.lineTo(C.r, Yr(1)); g.stroke();
  }
  // smooth trace, then the trace with the ring
  g.strokeStyle = rgba('#ffffff', 0.25); g.lineWidth = 1.2; g.beginPath();
  for (let t = x[0]; t <= xEnd; t += 0.5) { const y = C.Y(pressureAt({ ...c, knock: null }, t) / 1e5); t === x[0] ? g.moveTo(C.X(t), y) : g.lineTo(C.X(t), y); }
  g.stroke();
  g.strokeStyle = c.knock ? PAL.knock : PAL.ink; g.lineWidth = 2; g.beginPath();
  for (let t = x[0]; t <= xEnd; t += 0.1) { const y = C.Y(clamp(pressureAt(c, t) / 1e5, 0, pmax)); t === x[0] ? g.moveTo(C.X(t), y) : g.lineTo(C.X(t), y); }
  g.stroke();
  if (c.knock && c.knock.th <= xEnd) {
    g.fillStyle = PAL.knock; g.beginPath(); g.arc(C.X(c.knock.th), C.Y(c.knock.p / 1e5), 4, 0, 7); g.fill();
    g.font = FONT(fs, 500); g.textAlign = 'left'; g.textBaseline = 'bottom';
    g.fillText(`knock at ${c.knock.th > 0 ? '+' : ''}${c.knock.th}°`, C.X(c.knock.th) + 7, C.Y(c.knock.p / 1e5) - 6);
  }
  // cursor
  if (th != null && th >= x[0] && th <= x[1]) {
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.moveTo(C.X(th), C.t); g.lineTo(C.X(th), C.b); g.stroke();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(C.X(th), C.Y(clamp(pressureAt(c, th) / 1e5, 0, pmax)), 3.5, 0, 7); g.fill();
  }
  // key
  if (showI) {
    g.font = FONT(fs - 1); g.textAlign = 'right'; g.textBaseline = 'top';
    const kx = C.r - 6; let ky = C.t + 4;
    for (const [txt, col] of [['pressure', c.knock ? PAL.knock : PAL.ink], ['burned share', PAL.flame], ['knock integral I', PAL.integ]]) { g.fillStyle = col; g.fillText(txt, kx, ky); ky += fs + 4; }
  }
  return C;
}

// ---------------------------------------------------------------- required
export function drawRequired(g, w, h, { curves, cur, fuelOn, fs = 11 }) {
  const C = chart(g, w, h, { x: [7, 15], y: [40, 140], xl: 'compression ratio', yl: 'octane number needed', fs });
  g.strokeStyle = rgba(PAL.flame, 0.5); g.setLineDash([6, 4]); g.beginPath(); g.moveTo(C.l, C.Y(fuelOn)); g.lineTo(C.r, C.Y(fuelOn)); g.stroke(); g.setLineDash([]);
  g.fillStyle = PAL.flame; g.font = FONT(fs - 1); g.textAlign = 'left'; g.textBaseline = 'bottom'; g.fillText(`your fuel: ${fuelOn}`, C.l + 4, C.Y(fuelOn) - 3);
  const cols = ['#ff9a62', '#e8eaf0', '#62c4ff'];
  curves.forEach((cv, k) => {
    g.strokeStyle = cols[k % 3]; g.lineWidth = 2; g.beginPath();
    let started = false;
    for (const [x, y] of cv.pts) { if (y == null || y > 140) { started = false; continue; } const X = C.X(x), Y = C.Y(Math.max(40, y)); if (!started) { g.moveTo(X, Y); started = true; } else g.lineTo(X, Y); }
    g.stroke();
    const last = cv.pts.filter(p => p[1] != null && p[1] <= 140 && p[1] >= 40).pop();
    if (last) { g.fillStyle = cols[k % 3]; g.font = FONT(fs - 1); g.textAlign = 'right'; g.textBaseline = 'bottom'; g.fillText(`${cv.rpm} rpm`, C.X(last[0]) - 2, C.Y(last[1]) - 4); }
  });
  if (cur && cur.on != null) {
    const bad = cur.on > fuelOn;
    g.fillStyle = bad ? PAL.knock : '#9de8b6'; g.beginPath(); g.arc(C.X(cur.cr), C.Y(clamp(cur.on, 40, 140)), 5, 0, 7); g.fill();
    g.strokeStyle = '#05070d'; g.lineWidth = 1.5; g.stroke();
  }
}

// ---------------------------------------------------------------- spark
export function drawSpark(g, w, h, { pts, cur, fs = 11 }) {
  const ys = pts.map(p => p.imep);
  const y0 = Math.floor(Math.min(...ys) - 0.5), y1 = Math.ceil(Math.max(...ys) + 0.5);
  const C = chart(g, w, h, { x: [0, 45], y: [y0, y1], xl: 'spark advance, degrees before top centre', yl: 'work per cycle, IMEP bar', fs });
  // knock band
  let a = null;
  for (const p of pts) if (p.knock && a == null) a = p.spark;
  if (a != null) {
    g.fillStyle = rgba(PAL.knock, 0.12); g.fillRect(C.X(a - 0.5), C.t, C.r - C.X(a - 0.5), C.b - C.t);
    g.fillStyle = PAL.knock; g.font = FONT(fs - 1); g.textAlign = 'left'; g.textBaseline = 'top'; g.fillText('knocks', C.X(a - 0.5) + 5, C.t + 4);
  }
  g.strokeStyle = PAL.ink; g.lineWidth = 2; poly(g, pts.map(p => [p.spark, p.imep]), C.X, C.Y); g.stroke();
  let best = pts[0]; for (const p of pts) if (p.imep > best.imep) best = p;
  g.fillStyle = PAL.dim; g.font = FONT(fs - 1); g.textAlign = 'center'; g.textBaseline = 'bottom'; g.fillText('best timing', C.X(best.spark), C.Y(best.imep) - 6);
  g.fillStyle = PAL.dim; g.beginPath(); g.arc(C.X(best.spark), C.Y(best.imep), 3, 0, 7); g.fill();
  if (cur) { g.fillStyle = cur.knock ? PAL.knock : '#9de8b6'; g.beginPath(); g.arc(C.X(cur.spark), C.Y(cur.imep), 5, 0, 7); g.fill(); g.strokeStyle = '#05070d'; g.lineWidth = 1.5; g.stroke(); }
}

// ---------------------------------------------------------------- ladder
// fuels: [{ id, name, ron, fam }]; c8: ids joined as one formula.
// Returns hit boxes [{ id, x, y, r }].
export function drawLadder(g, w, h, { fuels, sel, hover, c8 = [], fs = 11, k = 1 }) {
  const l = 24, r = 24, axisY = h * 0.56;
  const X = v => l + (v + 25) / 150 * (w - l - r);
  // scale
  const grd = g.createLinearGradient(X(-25), 0, X(125), 0);
  grd.addColorStop(0, PAL.hep); grd.addColorStop(0.5, '#c9b6a0'); grd.addColorStop(1, PAL.iso);
  g.fillStyle = grd; g.globalAlpha = 0.85; g.fillRect(X(-25), axisY - 2, X(125) - X(-25), 4); g.globalAlpha = 1;
  g.font = FONT(fs - 1); g.fillStyle = PAL.dim; g.textAlign = 'center'; g.textBaseline = 'top';
  for (let v = -20; v <= 120; v += 20) { g.fillRect(X(v) - 0.5, axisY + 3, 1, 5); g.fillText(String(v), X(v), axisY + 10); }
  g.fillStyle = PAL.ink2; g.fillText('research octane number', X(50), axisY + 12 + fs);
  // the defining points
  for (const [v, col] of [[0, PAL.hep], [100, PAL.iso]]) {
    g.strokeStyle = rgba(col, 0.4); g.setLineDash([2, 3]); g.beginPath(); g.moveTo(X(v), 8); g.lineTo(X(v), axisY + 2); g.stroke(); g.setLineDash([]);
  }
  // C8H18 isomers: an arc under the axis
  const iso8 = fuels.filter(f => c8.includes(f.id)).sort((a, b) => a.ron - b.ron);
  if (iso8.length > 1) {
    const y = axisY + 26 + 2 * fs;
    g.strokeStyle = rgba('#e8eaf0', 0.45); g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(X(iso8[0].ron), axisY + 6); g.lineTo(X(iso8[0].ron), y); g.lineTo(X(iso8[iso8.length - 1].ron), y); g.lineTo(X(iso8[iso8.length - 1].ron), axisY + 6); g.stroke();
    for (const f of iso8.slice(1, -1)) { g.beginPath(); g.moveTo(X(f.ron), axisY + 6); g.lineTo(X(f.ron), y); g.stroke(); }
    g.fillStyle = PAL.ink2; g.font = FONT(fs - 1); g.textAlign = 'center'; g.textBaseline = 'top';
    g.fillText('all C₈H₁₈: same atoms, 126 points apart', (X(iso8[0].ron) + X(iso8[iso8.length - 1].ron)) / 2, y + 4);
  }
  // labels: greedy rows above the axis
  const sorted = [...fuels].sort((a, b) => a.ron - b.ron);
  g.font = FONT(fs - 1);
  const rows = [];
  const rowH = fs + 6, maxRows = Math.max(3, Math.floor((axisY - 14) / rowH));
  const boxes = [];
  sorted.forEach((f, idx) => {
    if (idx / sorted.length > k) return;
    const x = X(f.ron), tw = g.measureText(f.name).width + 8;
    let row = 0; while (row < maxRows - 1 && rows[row] != null && rows[row] > x - tw / 2) row++;
    rows[row] = x + tw / 2;
    const y = axisY - 14 - row * rowH;
    const col = FAMILY[f.fam].color, on = f.id === sel, hv = f.id === hover;
    g.strokeStyle = rgba(col, on ? 0.9 : 0.35); g.lineWidth = 1; g.beginPath(); g.moveTo(x, axisY - 4); g.lineTo(x, y + 6); g.stroke();
    g.fillStyle = col; g.beginPath(); g.arc(x, axisY, on ? 6 : 4.5, 0, 7); g.fill();
    if (on || hv) { g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.beginPath(); g.arc(x, axisY, 8, 0, 7); g.stroke(); }
    g.fillStyle = on ? '#fff' : hv ? PAL.ink : rgba(col, 0.95); g.font = FONT(fs - 1, on ? 600 : 400); g.textAlign = 'center'; g.textBaseline = 'bottom';
    g.fillText(f.name, x, y + 4);
    boxes.push({ id: f.id, x0: x - tw / 2, x1: x + tw / 2, y0: y - fs, y1: axisY + 8, x });
  });
  return boxes;
}

// ---------------------------------------------------------------- mechanism
// Two skeletons, the same five steps. step 0..4, k 0..1 inside the step.
const MECH_HEP = { c: Array.from({ length: 7 }, (_, i) => [i * ZX, (i % 2) * ZY]), b: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6]], site: 1, target: 3, prim: false };
const MECH_ISO = { c: [[0, 0], [ZX, ZY], [2 * ZX, 0], [3 * ZX, ZY], [4 * ZX, 0], [ZX - 0.5, ZY + ZX], [ZX + 0.5, ZY + ZX], [3 * ZX, ZY + 1]], b: [[0, 1], [1, 2], [2, 3], [3, 4], [1, 5], [1, 6], [3, 7]], site: 0, target: 5, prim: true };
export const MECH_STEPS = [
  { name: 'Start', text: 'Fuel and air at 700-900 K in the end gas, before the flame arrives. Nothing burns yet; a few radicals (OH, HO2) are always present.' },
  { name: 'Lose an H', text: 'An OH radical takes a hydrogen from the fuel: RH + OH -> R + H2O. Heptane gives up a secondary H (CH2, 412 kJ/mol). On iso-octane, 15 of 18 H are primary (CH3, 423 kJ/mol): slower.' },
  { name: 'Add O2', text: 'Oxygen adds to the carbon radical: R + O2 -> ROO, a peroxy radical. Below about 850 K this step wins; it reverses when the gas gets hotter.' },
  { name: 'Bend back', text: 'The peroxy group bends back and takes an H from a carbon two bonds along, through a six-membered ring: ROO -> QOOH. Heptane has a CH2 in reach. From an iso-octane methyl the nearest H in reach sits on another methyl: a primary H, a slower shift.' },
  { name: 'Branch', text: 'A second O2 adds and the molecule breaks into a ketohydroperoxide and OH; that splits again into two more radicals. One radical in, three out: chain branching. When it outruns the flame, the end gas ignites by itself.' },
];
export function drawMech(g, w, h, { step, k = 1, fs = 11 }) {
  g.fillStyle = PAL.bg; g.fillRect(0, 0, w, h);
  const half = w / 2;
  [[MECH_HEP, 'n-heptane', PAL.hep, 0], [MECH_ISO, 'iso-octane', PAL.iso, half]].forEach(([M, name, col, ox]) => {
    const s = Math.min(half / 5.6, h / 5.2), cx = ox + half / 2, cy = h * 0.58;
    const P = centre(M.c).map(([x, y]) => [cx + x * s, cy - y * s]);
    g.fillStyle = col; g.font = FONT(fs + 1, 500); g.textAlign = 'center'; g.textBaseline = 'top'; g.fillText(name, cx, 10);
    // bonds
    g.strokeStyle = rgba('#c9d1de', 0.85); g.lineWidth = 2.4; g.lineCap = 'round';
    g.beginPath(); for (const [a, b] of M.b) { g.moveTo(P[a][0], P[a][1]); g.lineTo(P[b][0], P[b][1]); } g.stroke();
    // carbons
    for (const [x, y] of P) { g.fillStyle = PAL.C; g.beginPath(); g.arc(x, y, s * 0.13, 0, 7); g.fill(); }
    const site = P[M.site], tgt = P[M.target];
    const up = M.prim ? [-0.5, -0.86] : [0, -1];              // direction of the new group
    const hR = s * 0.09;
    const H = (x, y, a = 1) => { g.fillStyle = rgba('#e9edf2', a); g.beginPath(); g.arc(x, y, hR, 0, 7); g.fill(); };
    const O = (x, y) => { g.fillStyle = PAL.O; g.beginPath(); g.arc(x, y, s * 0.12, 0, 7); g.fill(); };
    const dot = (x, y) => { g.fillStyle = '#ffe680'; g.beginPath(); g.arc(x, y, s * 0.06, 0, 7); g.fill(); g.strokeStyle = rgba('#ffe680', 0.4); g.lineWidth = 3; g.beginPath(); g.arc(x, y, s * 0.12, 0, 7); g.stroke(); };
    const sx = site[0] + up[0] * s * 0.55, sy = site[1] + up[1] * s * 0.55;
    const tH = [tgt[0] + (M.prim ? -0.35 : 0.35) * s, tgt[1] - 0.45 * s];
    // step 0-1: the H on the site leaves with an OH
    if (step === 0) H(sx, sy);
    if (step === 1) {
      const t = smooth(k);
      const ohx = lerp(sx + s * 1.1, sx, 0.4) + t * s * 0.9, ohy = sy - s * 0.4 - t * s * 0.5;
      H(lerp(sx, ohx - s * 0.18, t), lerp(sy, ohy, t)); O(ohx, ohy); H(ohx + s * 0.18, ohy - s * 0.1);
      if (t > 0.5) dot(site[0] + up[0] * s * 0.2, site[1] + up[1] * s * 0.2);
      g.fillStyle = PAL.dim; g.font = FONT(fs - 1); g.textAlign = 'center'; g.textBaseline = 'bottom'; g.fillText(t > 0.6 ? 'H2O leaves' : 'OH', ohx, ohy - s * 0.2);
    }
    // peroxy group on the site
    const o1 = [site[0] + up[0] * s * 0.6, site[1] + up[1] * s * 0.6];
    const o2 = step >= 3 ? [lerp(o1[0] + up[0] * s * 0.6, (o1[0] + tH[0]) / 2 + (M.prim ? -0.2 : 0) * s, step === 3 ? smooth(k) : 1), lerp(o1[1] + up[1] * s * 0.6, Math.min(o1[1], tH[1]) - s * 0.35, step === 3 ? smooth(k) : 1)] : [o1[0] + up[0] * s * 0.6, o1[1] + up[1] * s * 0.6];
    if (step >= 2) {
      const a = step === 2 ? smooth(k) : 1;
      g.globalAlpha = a;
      g.strokeStyle = rgba('#ff8a7a', 0.8); g.lineWidth = 2.4; g.beginPath(); g.moveTo(site[0], site[1]); g.lineTo(o1[0], o1[1]); g.lineTo(o2[0], o2[1]); g.stroke();
      O(o1[0], o1[1]); O(o2[0], o2[1]);
      if (step === 2) dot(o2[0] + s * 0.12, o2[1] - s * 0.12);
      g.globalAlpha = 1;
    }
    // target H, its shift through the ring
    if (step < 3) H(tH[0], tH[1], 0.85);
    if (step === 3) {
      const t = smooth(clamp((k - 0.35) / 0.55, 0, 1));
      // ring
      g.strokeStyle = rgba('#ffe680', 0.35 * (1 - Math.abs(t - 0.5))); g.setLineDash([3, 4]); g.lineWidth = 1.5;
      const pts = [site, o1, o2, tH, tgt, P[M.prim ? 1 : 2]];
      g.beginPath(); pts.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath(); g.stroke(); g.setLineDash([]);
      H(lerp(tH[0], o2[0], t), lerp(tH[1], o2[1] - s * 0.22, t));
      if (t > 0.5) dot(tgt[0] + (M.prim ? -0.25 : 0.25) * s, tgt[1] - 0.3 * s);
      g.fillStyle = M.prim ? PAL.knock : '#9de8b6'; g.font = FONT(fs - 1, 500); g.textAlign = 'center'; g.textBaseline = 'top';
      g.fillText(M.prim ? 'primary H: slow' : 'secondary H: fast', cx, h - fs - 12);
    }
    if (step === 4) {
      H(o2[0], o2[1] - s * 0.22);
      const t = smooth(k), n = M.prim ? 1 + Math.round(t) : 1 + Math.round(t * 2);
      // second O2 on the target and radicals flying off
      const o3 = [tgt[0] + (M.prim ? -0.2 : 0.2) * s, tgt[1] - 0.6 * s], o4 = [o3[0], o3[1] - 0.6 * s];
      g.strokeStyle = rgba('#ff8a7a', 0.8); g.lineWidth = 2.4; g.beginPath(); g.moveTo(tgt[0], tgt[1]); g.lineTo(o3[0], o3[1]); g.lineTo(o4[0], o4[1]); g.stroke();
      O(o3[0], o3[1]); O(o4[0], o4[1]);
      for (let q = 0; q < n; q++) {
        const ang = -Math.PI / 2 + (q - (n - 1) / 2) * 0.7, d = s * (0.8 + 1.4 * t);
        const x = cx + Math.cos(ang) * d, y = cy - s * 1.6 + Math.sin(ang) * d * 0.6;
        O(x, y); H(x + s * 0.17, y - s * 0.08); dot(x - s * 0.15, y - s * 0.12);
      }
      g.fillStyle = PAL.ink; g.font = FONT(fs, 500); g.textAlign = 'center'; g.textBaseline = 'top';
      g.fillText(M.prim ? 'fewer branches, later' : '1 radical in, 3 out', cx, h - fs - 12);
    }
  });
  // divider
  g.strokeStyle = 'rgba(255,255,255,0.08)'; g.beginPath(); g.moveTo(half, 14); g.lineTo(half, h - 14); g.stroke();
}

// ---------------------------------------------------------------- shifts
export function drawShift(g, w, h, { pts, sel, fs = 11 }) {
  const C = chart(g, w, h, { x: [0, 2.2], y: [-30, 120], xl: 'easy H-shift paths per H', yl: 'RON', fs });
  for (const p of pts) {
    const col = FAMILY[p.fam].color, on = p.id === sel;
    g.fillStyle = col; g.beginPath(); g.arc(C.X(p.x), C.Y(p.y), on ? 6 : 4.5, 0, 7); g.fill();
    if (on) { g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.beginPath(); g.arc(C.X(p.x), C.Y(p.y), 8, 0, 7); g.stroke(); }
    g.fillStyle = on ? '#fff' : PAL.ink2; g.font = FONT(fs - 2, on ? 600 : 400); g.textAlign = 'left'; g.textBaseline = 'middle';
    const right = C.X(p.x) + 8 + g.measureText(p.name).width < C.r;
    g.textAlign = right ? 'left' : 'right';
    g.fillText(p.name, C.X(p.x) + (right ? 8 : -8), C.Y(p.y) + (p.dy || 0));
  }
}

// ---------------------------------------------------------------- RON-MON
export function drawRonMon(g, w, h, { fuels, gas, sel, fs = 11 }) {
  const C = chart(g, w, h, { x: [-25, 125], y: [-25, 125], xl: 'research octane number (RON)', yl: 'motor octane number (MON)', fs });
  g.strokeStyle = 'rgba(255,255,255,0.3)'; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(C.X(-25), C.Y(-25)); g.lineTo(C.X(125), C.Y(125)); g.stroke(); g.setLineDash([]);
  g.fillStyle = PAL.dim; g.font = FONT(fs - 1); g.textAlign = 'left'; g.textBaseline = 'bottom';
  g.save(); g.translate(C.X(-10), C.Y(-8)); g.rotate(-Math.atan2(C.Y(-25) - C.Y(125), C.X(125) - C.X(-25))); g.fillText('RON = MON', 0, -3); g.restore();
  for (const f of fuels) {
    if (f.mon == null) continue;
    const col = FAMILY[f.fam].color, on = f.id === sel;
    // sensitivity stem
    g.strokeStyle = rgba(col, 0.4); g.lineWidth = 1; g.beginPath(); g.moveTo(C.X(f.ron), C.Y(f.ron)); g.lineTo(C.X(f.ron), C.Y(f.mon)); g.stroke();
    g.fillStyle = col; g.beginPath(); g.arc(C.X(f.ron), C.Y(f.mon), on ? 6 : 4.5, 0, 7); g.fill();
    if (on) { g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.beginPath(); g.arc(C.X(f.ron), C.Y(f.mon), 8, 0, 7); g.stroke(); }
    if (on || (f.ron - f.mon > 9) || f.ron < 30) {
      g.fillStyle = on ? '#fff' : PAL.ink2; g.font = FONT(fs - 1, on ? 600 : 400); g.textAlign = 'left'; g.textBaseline = 'middle';
      g.fillText(f.name, C.X(f.ron) + 9, C.Y(f.mon) + (f.id === 'methanol' ? 9 : f.id === 'ethanol' ? -5 : 0));
    }
  }
  for (const s of gas) {
    g.strokeStyle = '#e8eaf0'; g.lineWidth = 1.5; g.strokeRect(C.X(s.ron) - 4, C.Y(s.mon) - 4, 8, 8);
  }
  // zoom inset label for the gasolines
  g.fillStyle = PAL.dim; g.font = FONT(fs - 1); g.textAlign = 'right'; g.textBaseline = 'top';
  g.fillText('□ market gasolines', C.r - 4, C.b - fs - 8);
}
