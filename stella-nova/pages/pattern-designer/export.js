// ============================================================================
//  PATTERN DESIGNER  ·  export.js — style modes, SVG text, canvas drawing
// ----------------------------------------------------------------------------
//  No DOM. toSVG() writes the SVG file text, drawItems() draws the same
//  elements on any 2D context (the page preview, the PNG export, the
//  saver). Both read the same style rules, so the preview and the file
//  agree.
//
//  STYLE MODES (applyMode)
//    auto     the pattern's own fills and strokes
//    stroke   every element is an outline in its ink
//    fill     every closed element is a solid in its ink; open lines stay
//    knock    solids with a paper-colour outline (a cut-out look)
//
//  SVG. Elements in order. A run of elements with the same style shares
//  one <g>, so the file stays small and keeps the paint order. The file
//  has a viewBox in design units, and width and height in mm for A sizes.
//
//  grep -n targets
//    style mode ........... "export function applyMode"
//    path data ............ "function pathData"
//    svg file ............. "export function toSVG"
//    canvas ............... "export function drawItems"
//    reveal order ......... "export function revealPlan"
//    code extract ......... "export function codeExtract"
// ============================================================================
import { inkOf } from './palettes.js';

export function applyMode(items, mode) {
  if (!mode || mode === 'auto') return items;
  return items.map(e => {
    const closed = e.t !== 'poly' || e.c;
    const ink = e.f !== -1 ? e.f : e.s;
    if (mode === 'stroke') return Object.assign({}, e, { f: -1, s: ink });
    if (mode === 'fill') return closed ? Object.assign({}, e, { f: ink, s: -1 }) : e;
    if (mode === 'knock') return closed ? Object.assign({}, e, { f: ink, s: -2 }) : e;
    return e;
  });
}
// The colour of slot k: -1 none, -2 the paper.
const col = (pal, k) => k === -2 ? pal.bg : inkOf(pal, k);
const n2 = v => (Math.round(v * 100) / 100).toString();

// SVG path data for a flat point list. sm: Catmull-Rom as cubic Beziers.
export function pathData(p, closed, sm) {
  const m = p.length / 2;
  if (!sm || m < 3) {
    let d = 'M' + n2(p[0]) + ' ' + n2(p[1]);
    for (let i = 1; i < m; i++) d += 'L' + n2(p[2 * i]) + ' ' + n2(p[2 * i + 1]);
    return closed ? d + 'Z' : d;
  }
  let d = 'M' + n2(p[0]) + ' ' + n2(p[1]);
  crSegments(p, closed, (c1x, c1y, c2x, c2y, x, y) => { d += 'C' + n2(c1x) + ' ' + n2(c1y) + ' ' + n2(c2x) + ' ' + n2(c2y) + ' ' + n2(x) + ' ' + n2(y); });
  return closed ? d + 'Z' : d;
}
// Calls seg(c1x, c1y, c2x, c2y, x, y) for each Catmull-Rom span.
function crSegments(p, closed, seg) {
  const m = p.length / 2, P = i => closed ? (i + m) % m : Math.max(0, Math.min(m - 1, i));
  const last = closed ? m : m - 1;
  for (let i = 0; i < last; i++) {
    const a = P(i - 1), b = P(i), c = P(i + 1), d = P(i + 2);
    seg(p[2 * b] + (p[2 * c] - p[2 * a]) / 6, p[2 * b + 1] + (p[2 * c + 1] - p[2 * a + 1]) / 6,
        p[2 * c] - (p[2 * d] - p[2 * b]) / 6, p[2 * c + 1] - (p[2 * d + 1] - p[2 * b + 1]) / 6, p[2 * c], p[2 * c + 1]);
  }
}
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// opts: { W, H, palette, lw, title, desc, size: { w, h, unit } | null,
//         clip: [rings] | null, frame: bool }
export function toSVG(items, o) {
  const { W, H, palette: pal, lw = 2 } = o;
  const size = o.size ? ` width="${n2(o.size.w)}${o.size.unit}" height="${n2(o.size.h)}${o.size.unit}"` : ` width="${n2(W)}" height="${n2(H)}"`;
  const L = [];
  L.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n2(W)} ${n2(H)}"${size}>`);
  if (o.title) L.push(`  <title>${esc(o.title)}</title>`);
  if (o.desc) L.push(`  <desc>${esc(o.desc)}</desc>`);
  const clipD = o.clip && o.clip.length ? o.clip.map(r => pathData(r, true, false)).join('') : '';
  if (clipD) L.push(`  <defs><clipPath id="pd-clip"><path d="${clipD}" clip-rule="evenodd"/></clipPath></defs>`);
  L.push(`  <rect id="paper" width="${n2(W)}" height="${n2(H)}" fill="${pal.bg}"/>`);
  L.push(`  <g id="pattern"${clipD ? ' clip-path="url(#pd-clip)"' : ''} stroke-linecap="round" stroke-linejoin="round">`);
  let cur = null;
  for (const e of items) {
    const fill = e.f === -1 ? 'none' : col(pal, e.f), stroke = e.s === -1 ? 'none' : col(pal, e.s);
    const sw = stroke === 'none' ? 0 : lw * (e.w || 1) * (e.s === -2 ? 0.8 : 1);
    const key = fill + '|' + stroke + '|' + n2(sw);
    if (key !== cur) {
      if (cur) L.push('    </g>');
      L.push(`    <g fill="${fill}" stroke="${stroke}"${sw ? ` stroke-width="${n2(sw)}"` : ''}>`);
      cur = key;
    }
    if (e.t === 'circle') L.push(`      <circle cx="${n2(e.x)}" cy="${n2(e.y)}" r="${n2(e.r)}"/>`);
    else if (e.t === 'multi') L.push(`      <path fill-rule="evenodd" d="${e.rr.map(r => pathData(r, true, e.sm)).join('')}"/>`);
    else L.push(`      <path d="${pathData(e.p, !!e.c, e.sm)}"/>`);
  }
  if (cur) L.push('    </g>');
  L.push('  </g>');
  if (o.frame && clipD) L.push(`  <path id="frame" d="${clipD}" fill="none" stroke="${inkOf(pal, 0)}" stroke-width="${n2(lw * 1.5)}"/>`);
  L.push('</svg>');
  return L.join('\n') + '\n';
}

// Trace one element as a canvas path. upTo: the part of a poly to draw
// (0..1 of its points), for the stroke reveal.
function tracePath(g, e, upTo = 1) {
  if (e.t === 'circle') { g.moveTo(e.x + e.r, e.y); g.arc(e.x, e.y, e.r, 0, Math.PI * 2); return; }
  const rings = e.t === 'multi' ? e.rr : [e.p];
  for (const p of rings) {
    const closed = e.t === 'multi' || e.c;
    let m = p.length / 2;
    if (upTo < 1) m = Math.max(2, Math.ceil(m * upTo));
    if (e.sm && m >= 3) {
      const q = upTo < 1 ? p.slice(0, 2 * m) : p;
      g.moveTo(q[0], q[1]);
      crSegments(q, closed && upTo >= 1, (a, b, c, d, x, y) => g.bezierCurveTo(a, b, c, d, x, y));
    } else {
      g.moveTo(p[0], p[1]);
      for (let i = 1; i < m; i++) g.lineTo(p[2 * i], p[2 * i + 1]);
    }
    if (closed && upTo >= 1) g.closePath();
  }
}
// Draw items on a 2D context in design units (the caller sets the
// transform). o: { palette, lw, clip: rings|null, frame, reveal: plan|null,
// t: 0..1 }. With a reveal plan, only the part up to t is drawn.
export function drawItems(g, items, o) {
  const pal = o.palette, lw = o.lw || 2;
  g.save();
  g.lineCap = 'round'; g.lineJoin = 'round';
  if (o.clip && o.clip.length) {
    g.beginPath();
    for (const r of o.clip) { g.moveTo(r[0], r[1]); for (let i = 2; i < r.length; i += 2) g.lineTo(r[i], r[i + 1]); g.closePath(); }
    g.clip('evenodd');
  }
  const plan = o.reveal, T = plan ? (o.t ?? 1) * plan.total : Infinity;
  for (let i = 0; i < items.length; i++) {
    const e = items[i];
    let part = 1, alpha = 1;
    if (plan) {
      const s = plan.start[i], len = plan.len[i];
      if (s >= T) break;
      part = len > 0 ? Math.min(1, (T - s) / len) : 1;
      alpha = e.f >= 0 || e.f === -2 ? Math.min(1, part * 1.6) : 1;
    }
    g.beginPath();
    const strokeOnly = e.f === -1;
    tracePath(g, e, strokeOnly && e.t === 'poly' ? part : 1);
    if (e.f !== -1) { g.globalAlpha = alpha; g.fillStyle = col(pal, e.f); g.fill(e.t === 'multi' ? 'evenodd' : 'nonzero'); }
    if (e.s !== -1) {
      g.globalAlpha = e.f === -1 ? 1 : alpha;
      g.strokeStyle = col(pal, e.s); g.lineWidth = lw * (e.w || 1) * (e.s === -2 ? 0.8 : 1);
      if (e.t !== 'poly' && e.f === -1 && part < 1 && e.t === 'circle') {
        g.beginPath(); g.arc(e.x, e.y, e.r, -Math.PI / 2, -Math.PI / 2 + part * Math.PI * 2);
      }
      g.stroke();
    }
    g.globalAlpha = 1;
  }
  g.restore();
  if (o.frame && o.clip && o.clip.length) {
    g.save(); g.beginPath();
    for (const r of o.clip) { g.moveTo(r[0], r[1]); for (let i = 2; i < r.length; i += 2) g.lineTo(r[i], r[i + 1]); g.closePath(); }
    g.lineWidth = lw * 1.5; g.strokeStyle = inkOf(pal, 0); g.stroke(); g.restore();
  }
}
// The reveal plan: each element gets a start and a length on one time
// line. Strokes cost their length, fills a fixed share, so a field of
// many small solids does not take longer than one long line.
export function revealPlan(items) {
  const n = items.length, start = new Float64Array(n), len = new Float64Array(n);
  let t = 0;
  for (let i = 0; i < n; i++) {
    const e = items[i];
    let L;
    if (e.t === 'circle') L = e.f === -1 ? 2 * Math.PI * e.r : 18 + e.r * 0.5;
    else if (e.t === 'multi') L = 120;
    else if (e.f !== -1) L = 18 + Math.sqrt(Math.abs(area(e.p))) * 0.4;
    else { L = 0; const p = e.p; for (let k = 2; k < p.length; k += 2) L += Math.hypot(p[k] - p[k - 2], p[k + 1] - p[k - 1]); }
    start[i] = t; len[i] = Math.max(1, L); t += len[i];
  }
  return { start, len, total: t || 1 };
}
function area(p) { let s = 0; const m = p.length / 2; for (let i = 0; i < m; i++) { const j = (i + 1) % m; s += p[2 * i] * p[2 * j + 1] - p[2 * j] * p[2 * i + 1]; } return s / 2; }

// The first lines of a function's source, without its signature.
export function codeExtract(fn, n = 12) {
  const L = String(fn).split('\n');
  const body = L.slice(1, -1).filter(l => l.trim() && !/^\s*\/\//.test(l));
  return body.slice(0, n).join('\n');
}
