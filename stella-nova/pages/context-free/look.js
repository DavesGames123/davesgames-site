// ============================================================================
//  CONTEXT FREE  ·  look.js — colour themes, backgrounds and the composite
// ----------------------------------------------------------------------------
//  Our own code (GPL-2.0-or-later, see COPYING).
//
//  A theme recolours a design that sets no colour of its own: the engine
//  render becomes a coverage mask (toMask: how far each pixel is from the
//  design background), the page tints the mask with the theme ink and puts
//  it over the theme paper. A design with colour keeps its colours; with
//  "theme background" on, it renders on a clear background (the define
//  CF::Background = [a -1], CFDG 3 designs only) and goes over the paper.
//
//  THEMES          the list (id, name, paper, paper2, ink, ink2, glow, bg)
//  BG_STYLES       solid, gradient, grain, grid
//  plan(look, info, defsIgnored) -> { kind, paper, ink }
//                  kind: 'plain' (the render as it is), 'mask', 'over'
//  defsFor(look)   the define to ask for (a clear background) or ''
//  toMask(px, info)          RGBA in place -> black with coverage alpha
//  compose(img, w, h, look, kind, info, scale) -> a canvas of w x h
//  loadLook() / saveLook(look)   localStorage, per viewer
//
//  GREP MAP
//    grep -n 'export const THEMES'
//    grep -n 'export function compose'
//    grep -n 'function paintPaper'
// ============================================================================
export const THEMES = [
  { id: 'design', name: 'Design colours' },
  { id: 'paper', name: 'Paper and ink', paper: '#f1e7d2', paper2: '#e0d0ae', ink: '#2b2118', bg: 'grain' },
  { id: 'ink', name: 'Ink on white', paper: '#ffffff', paper2: '#f1f1ee', ink: '#141414', bg: 'solid' },
  { id: 'night', name: 'Night', paper: '#111a2c', paper2: '#04070e', ink: '#d8e5ff', bg: 'gradient' },
  { id: 'blueprint', name: 'Blueprint', paper: '#1f4f8f', paper2: '#163a69', ink: '#eaf3ff', bg: 'grid' },
  { id: 'gold', name: 'Black and gold', paper: '#15130e', paper2: '#050504', ink: '#dcb45e', bg: 'gradient' },
  { id: 'riso', name: 'Riso two-tone', paper: '#f5efe3', paper2: '#ebe2d0', ink: '#ff4f7b', ink2: '#2f6fd6', bg: 'grain' },
  { id: 'pastel', name: 'Pastel', paper: '#fdeaf0', paper2: '#e3eefc', ink: '#6670c6', bg: 'gradient' },
  { id: 'neon', name: 'Neon on black', paper: '#07070c', paper2: '#000000', ink: '#3dffb0', glow: true, bg: 'solid' },
  { id: 'sepia', name: 'Sepia', paper: '#eddcbc', paper2: '#d6bd93', ink: '#5a3920', bg: 'grain' },
  { id: 'chalk', name: 'Chalkboard', paper: '#26352d', paper2: '#19231e', ink: '#f0efe4', bg: 'grain' },
  { id: 'terminal', name: 'Terminal', paper: '#03140b', paper2: '#010603', ink: '#45ff78', glow: true, bg: 'grid' },
];
export const BG_STYLES = ['theme', 'solid', 'gradient', 'grain', 'grid'];
export const DEFAULT_LOOK = { theme: 'design', bgStyle: 'theme', bg: '', ink: '', colourBg: true };

export const themeOf = id => THEMES.find(t => t.id === id) || THEMES[0];

const KEY = 'cf-look-v1';
export function loadLook() {
  try { return Object.assign({}, DEFAULT_LOOK, JSON.parse(localStorage.getItem(KEY) || '{}')); }
  catch (e) { return Object.assign({}, DEFAULT_LOOK); }
}
export function saveLook(look) { try { localStorage.setItem(KEY, JSON.stringify(look)); } catch (e) { /* private mode */ } }

const hex = c => '#' + c.slice(0, 3).map(v => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('');

// Is the look anything but the design as it is?
const themed = look => look.theme !== 'design' || !!look.bg || !!look.ink;

// The define that asks the engine for a clear background, or ''.
export function defsFor(look) {
  return themed(look) && look.colourBg ? 'CF::Background = [a -1]' : '';
}

// How to show a render: the kind and the two colours.
export function plan(look, info, defsIgnored = false) {
  const t = themeOf(look.theme);
  const designBg = info && info.bg ? hex(info.bg) : '#ffffff';
  const paper = look.bg || t.paper || designBg;
  const ink = look.ink || t.ink || '#000000';
  if (!themed(look) || !info) return { kind: 'plain', paper: designBg, ink, theme: t };
  const clear = !!defsFor(look) && !defsIgnored;
  if (!info.usesColor) return { kind: 'mask', paper, ink, theme: t };
  return { kind: clear ? 'over' : 'plain', paper, ink, theme: t };
}

// RGBA in place: black, with alpha = the distance of the pixel from the
// design background (in luminance), or the pixel alpha on a clear one.
export function toMask(px, info) {
  const bg = (info && info.bg) || [1, 1, 1, 1];
  const clearBg = bg[3] < 0.5;
  const bgL = 0.299 * bg[0] + 0.587 * bg[1] + 0.114 * bg[2];
  const span = Math.max(bgL, 1 - bgL) || 1;
  for (let i = 0; i < px.length; i += 4) {
    const a = px[i + 3] / 255;
    const L = (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) / 255;
    const cov = clearBg ? a : a * Math.min(1, Math.abs(L - bgL) / span);
    px[i] = px[i + 1] = px[i + 2] = 0;
    px[i + 3] = Math.round(cov * 255);
  }
  return px;
}

// ── compose ─────────────────────────────────────────────────────────────────
let grainTile = null;
function grain() {
  if (grainTile) return grainTile;
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d'), d = x.createImageData(256, 256);
  let s = 0x9e3779b9;
  const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
  for (let i = 0; i < d.data.length; i += 4) {
    const v = rnd(), on = v > 0.5;
    d.data[i] = d.data[i + 1] = d.data[i + 2] = on ? 255 : 0;
    d.data[i + 3] = Math.round(Math.abs(v - 0.5) * 2 * 26);
  }
  x.putImageData(d, 0, 0);
  return (grainTile = c);
}

function paintPaper(x, w, h, paper, paper2, style, scale) {
  x.fillStyle = paper; x.fillRect(0, 0, w, h);
  if (style === 'gradient' || style === 'grain') {
    const g = x.createRadialGradient(w * 0.5, h * 0.42, 0, w * 0.5, h * 0.5, Math.hypot(w, h) * 0.62);
    g.addColorStop(0, paper); g.addColorStop(1, paper2 || paper);
    x.fillStyle = g; x.fillRect(0, 0, w, h);
  }
  if (style === 'grain') {
    x.save(); x.fillStyle = x.createPattern(grain(), 'repeat'); x.fillRect(0, 0, w, h); x.restore();
  }
  if (style === 'grid') {
    const step = Math.max(12, Math.round(36 * scale));
    x.save(); x.strokeStyle = paper2 && paper2 !== paper ? paper2 : 'rgba(255,255,255,0.08)';
    x.globalAlpha = 0.9; x.lineWidth = Math.max(1, scale);
    x.beginPath();
    for (let gx = (w % step) / 2; gx < w; gx += step) { x.moveTo(Math.round(gx) + 0.5, 0); x.lineTo(Math.round(gx) + 0.5, h); }
    for (let gy = (h % step) / 2; gy < h; gy += step) { x.moveTo(0, Math.round(gy) + 0.5); x.lineTo(w, Math.round(gy) + 0.5); }
    x.stroke(); x.restore();
  }
}

const pool = { tint: null, tint2: null };
function tinted(key, img, w, h, ink) {
  let c = pool[key];
  if (!c) c = pool[key] = document.createElement('canvas');
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  const x = c.getContext('2d');
  x.globalCompositeOperation = 'source-over';
  x.clearRect(0, 0, w, h);
  x.fillStyle = ink; x.fillRect(0, 0, w, h);
  x.globalCompositeOperation = 'destination-in';
  x.drawImage(img, 0, 0, w, h);
  x.globalCompositeOperation = 'source-over';
  return c;
}

// The picture as the page shows it: a canvas of w x h (the render size).
// scale: device px per css px of the render (for the grid step and the
// riso offset). out: a canvas to reuse.
export function compose(img, w, h, look, p, scale = 1, out = null) {
  const c = out || document.createElement('canvas');
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  const x = c.getContext('2d');
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.globalAlpha = 1; x.globalCompositeOperation = 'source-over'; x.shadowBlur = 0;
  if (p.kind === 'plain') { x.clearRect(0, 0, w, h); x.drawImage(img, 0, 0, w, h); return c; }
  const t = p.theme;
  const style = look.bgStyle === 'theme' ? (t.bg || 'solid') : look.bgStyle;
  paintPaper(x, w, h, p.paper, look.bg ? '' : t.paper2, style, scale);
  if (p.kind === 'over') { x.drawImage(img, 0, 0, w, h); return c; }
  const ink = tinted('tint', img, w, h, p.ink);
  if (t.glow && !look.ink) {
    x.save(); x.shadowColor = p.ink; x.shadowBlur = 10 * scale; x.globalAlpha = 0.85; x.drawImage(ink, 0, 0); x.restore();
  }
  x.drawImage(ink, 0, 0);
  if (t.ink2 && !look.ink) {
    const ink2 = tinted('tint2', img, w, h, t.ink2);
    const d = Math.max(1, Math.round(2 * scale));
    x.save(); x.globalCompositeOperation = 'multiply'; x.globalAlpha = 0.8; x.drawImage(ink2, d, -d); x.restore();
  }
  return c;
}
