// ============================================================================
//  SCIENCE TOOLKIT  ·  kit.js  ·  shared helpers for the tool modules
// ----------------------------------------------------------------------------
//  Pure ES module, no DOM. The tool modules (tools/*.js) and tests.mjs use
//  it. It parses number lists and "value ± uncertainty" pairs, formats
//  numbers, makes a seeded random source, and draws plots as SVG strings.
//  An SVG string has its own background and colours, so an export of it
//  looks the same outside the page.
//
//  GREP MAP
//    grep -n "export function fmt"        number to text (significant digits)
//    grep -n "export function nums"       text to a list of numbers
//    grep -n "export function pm"         "1.23 ± 0.04" to [value, unc]
//    grep -n "export function table"      rows of cells from pasted text
//    grep -n "export function rng"        seeded uniform and normal source
//    grep -n "export function plot"       line, scatter, bar and area plot
//    grep -n "export function histogram"  bins and a bar plot
//    grep -n "export function boxplot"    a box plot
//    grep -n "export function esc"        HTML escape
// ============================================================================

// Number to text with `sig` significant digits. Small and large values use
// e-notation. Trailing zeros after the decimal point are removed.
export function fmt(x, sig = 6) {
  if (typeof x === 'bigint') return x.toString();
  if (!Number.isFinite(x)) return Number.isNaN(x) ? 'NaN' : (x > 0 ? '∞' : '−∞');
  if (x === 0) return '0';
  const a = Math.abs(x);
  let s;
  if (a >= 1e-4 && a < 10 ** sig) s = x.toPrecision(sig);
  else s = x.toExponential(sig - 1);
  if (s.includes('e')) {
    let [m, e] = s.split('e');
    if (m.includes('.')) m = m.replace(/0+$/, '').replace(/\.$/, '');
    return `${m}e${e.replace('+', '')}`;
  }
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s;
}

// Fixed digits after the point, for p-values and percentages.
export const fix = (x, d = 4) => Number.isFinite(x) ? x.toFixed(d) : fmt(x);

// A p-value as text: very small values in e-notation.
export const pfmt = (p) => p < 1e-4 ? fmt(p, 3) : p.toFixed(4);

// HTML escape.
export function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Parse one number. Accepts a Unicode minus, "×10^", and e-notation.
export function num(s) {
  if (typeof s === 'number') return s;
  const t = String(s).trim().replace(/−/g, '-').replace(/\s*[×x]\s*10\^?\s*([-+]?\d+)/, 'e$1').replace(/^\+/, '');
  if (t === '') throw new Error('A number is missing.');
  if (/^[-]?(inf|infinity|∞)$/i.test(t)) return t.startsWith('-') ? -Infinity : Infinity;
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) throw new Error(`"${s}" is not a number.`);
  return Number(t);
}

// Text to numbers. Separators: comma, semicolon, space, tab, new line.
// A line that starts with # is a comment.
export function nums(text) {
  const out = [];
  for (const line of String(text).split(/\r?\n/)) {
    if (/^\s*#/.test(line)) continue;
    for (const tok of line.split(/[\s,;]+/)) if (tok) out.push(num(tok));
  }
  return out;
}

// "1.23 ± 0.04", "1.23 +- 0.04", "1.23(4)" -> [1.23, 0.04].
export function pm(s) {
  const t = String(s).trim();
  const m = /^(.+?)\s*(?:±|\+\/-|\+-)\s*(.+)$/.exec(t);
  if (m) return [num(m[1]), num(m[2])];
  const c = /^([-+]?\d*\.?\d*)\((\d+)\)(e[-+]?\d+)?$/i.exec(t.replace(/\s/g, ''));
  if (c) {
    const dec = (c[1].split('.')[1] || '').length;
    const scale = c[3] ? 10 ** Number(c[3].slice(1)) : 1;
    return [Number(c[1]) * scale, Number(c[2]) * 10 ** -dec * scale];
  }
  throw new Error(`"${s}" needs a value and an uncertainty, for example 1.23 ± 0.04.`);
}

// Pasted text to rows of cells. The separator is the first of tab, comma
// or semicolon that is found; else runs of spaces.
export function table(text) {
  const lines = String(text).split(/\r?\n/).filter(l => l.trim() !== '' && !/^\s*#/.test(l));
  const first = lines[0] || '';
  const sep = first.includes('\t') ? '\t' : first.includes(',') ? ',' : first.includes(';') ? ';' : /\s+/;
  return lines.map(l => l.split(sep).map(c => c.trim()));
}

// Seeded random source (mulberry32) with a Box–Muller normal.
export function rng(seed = 1) {
  let a = seed >>> 0;
  const u = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let spare = null;
  const normal = () => {
    if (spare !== null) { const s = spare; spare = null; return s; }
    let x = 0;
    while (x === 0) x = u();
    const r = Math.sqrt(-2 * Math.log(x)), th = 2 * Math.PI * u();
    spare = r * Math.sin(th);
    return r * Math.cos(th);
  };
  return { u, normal };
}

// ── plots ───────────────────────────────────────────────────────────────────
export const PLOT_COLORS = ['#62c4ff', '#ff9a62', '#86dc7c', '#e889dc', '#ffd666', '#a8a4ff'];

// Tick values from lo to hi, about n of them, on 1-2-5 steps.
export function ticks(lo, hi, n = 6) {
  if (!(hi > lo)) { const d = Math.abs(lo) || 1; lo -= d * 0.5; hi += d * 0.5; }
  const raw = (hi - lo) / n, p = 10 ** Math.floor(Math.log10(raw)), f = raw / p;
  const step = (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p;
  const out = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return out;
}

const tickText = (v) => {
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-3 || a >= 1e5)) return v.toExponential(1).replace('+', '');
  return String(Number(v.toPrecision(6)));
};

// series: [{ x:[], y:[], type:'line'|'scatter'|'bar'|'area', color, name, w }]
// Options: xlabel, ylabel, w, h, title, logy, xr:[lo,hi], yr:[lo,hi],
// vlines:[{x, color, dash}], hlines:[{y, color, dash}].
export function plot(series, o = {}) {
  const W = o.w || 640, H = o.h || 360, L = 64, R = 16, T = o.title ? 28 : 14, B = 46;
  const tf = (v) => o.logy ? Math.log10(v) : v;
  let xs = [], ys = [];
  for (const s of series) for (let i = 0; i < s.x.length; i++) {
    if (Number.isFinite(s.x[i]) && Number.isFinite(tf(s.y[i]))) { xs.push(s.x[i]); ys.push(tf(s.y[i])); }
  }
  if (!xs.length) { xs = [0, 1]; ys = [0, 1]; }
  let [x0, x1] = o.xr || [Math.min(...xs), Math.max(...xs)];
  let [y0, y1] = o.yr || [Math.min(...ys), Math.max(...ys)];
  if (series.some(s => s.type === 'bar' || s.type === 'area') && !o.logy) { y0 = Math.min(0, y0); y1 = Math.max(0, y1); }
  if (!o.yr) { const pad = (y1 - y0) * 0.06 || Math.abs(y0) * 0.1 || 1; y0 -= series.some(s => s.type === 'bar') && y0 === 0 ? 0 : pad; y1 += pad; }
  if (x1 === x0) { x0 -= 1; x1 += 1; }
  if (y1 === y0) { y0 -= 1; y1 += 1; }
  const px = (x) => L + (x - x0) / (x1 - x0) * (W - L - R);
  const py = (y) => H - B - (tf(y) - y0) / (y1 - y0) * (H - T - B);
  const pyr = (v) => H - B - (v - y0) / (y1 - y0) * (H - T - B);
  const g = [];
  g.push(`<rect width="${W}" height="${H}" fill="#0b1014"/>`);
  if (o.title) g.push(`<text x="${L}" y="18" fill="#d3dde0" font-size="13">${esc(o.title)}</text>`);
  for (const t of ticks(x0, x1, Math.max(3, Math.round((W - L - R) / 90)))) {
    const X = px(t).toFixed(1);
    g.push(`<line x1="${X}" x2="${X}" y1="${T}" y2="${H - B}" stroke="#1d2a2f"/>`);
    g.push(`<text x="${X}" y="${H - B + 16}" fill="#8fa3a8" font-size="11" text-anchor="middle">${tickText(t)}</text>`);
  }
  for (const t of ticks(y0, y1, Math.max(3, Math.round((H - T - B) / 55)))) {
    const Y = pyr(t).toFixed(1);
    g.push(`<line x1="${L}" x2="${W - R}" y1="${Y}" y2="${Y}" stroke="#1d2a2f"/>`);
    g.push(`<text x="${L - 6}" y="${(+Y + 4).toFixed(1)}" fill="#8fa3a8" font-size="11" text-anchor="end">${o.logy ? '1e' + t : tickText(t)}</text>`);
  }
  g.push(`<rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="none" stroke="#2f4046"/>`);
  for (const v of o.vlines || []) g.push(`<line x1="${px(v.x).toFixed(1)}" x2="${px(v.x).toFixed(1)}" y1="${T}" y2="${H - B}" stroke="${v.color || '#ffd666'}" stroke-dasharray="${v.dash || '4 3'}"/>`);
  for (const v of o.hlines || []) g.push(`<line x1="${L}" x2="${W - R}" y1="${py(v.y).toFixed(1)}" y2="${py(v.y).toFixed(1)}" stroke="${v.color || '#ffd666'}" stroke-dasharray="${v.dash || '4 3'}"/>`);
  g.push(`<clipPath id="pc"><rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}"/></clipPath><g clip-path="url(#pc)">`);
  series.forEach((s, k) => {
    const c = s.color || PLOT_COLORS[k % PLOT_COLORS.length];
    const pts = [];
    for (let i = 0; i < s.x.length; i++) if (Number.isFinite(s.x[i]) && Number.isFinite(tf(s.y[i]))) pts.push([px(s.x[i]), py(s.y[i])]);
    if (s.type === 'scatter') for (const [X, Y] of pts) g.push(`<circle cx="${X.toFixed(1)}" cy="${Y.toFixed(1)}" r="${s.r || 2.6}" fill="${c}"/>`);
    else if (s.type === 'bar') {
      const bw = s.w != null ? Math.abs(px(s.x[0] + s.w) - px(s.x[0])) : (W - L - R) / Math.max(1, s.x.length) * 0.9;
      for (const [X, Y] of pts) g.push(`<rect x="${(X - bw / 2).toFixed(1)}" y="${Math.min(Y, pyr(0)).toFixed(1)}" width="${Math.max(1, bw - 1).toFixed(1)}" height="${Math.abs(pyr(0) - Y).toFixed(1)}" fill="${c}" fill-opacity="0.75"/>`);
    } else if (pts.length) {
      const d = pts.map(([X, Y], i) => `${i ? 'L' : 'M'}${X.toFixed(1)} ${Y.toFixed(1)}`).join('');
      if (s.type === 'area') g.push(`<path d="${d}L${pts[pts.length - 1][0].toFixed(1)} ${pyr(Math.max(y0, 0)).toFixed(1)}L${pts[0][0].toFixed(1)} ${pyr(Math.max(y0, 0)).toFixed(1)}Z" fill="${c}" fill-opacity="0.25"/>`);
      g.push(`<path d="${d}" fill="none" stroke="${c}" stroke-width="${s.sw || 1.8}"${s.dash ? ` stroke-dasharray="${s.dash}"` : ''}/>`);
    }
  });
  g.push('</g>');
  if (o.xlabel) g.push(`<text x="${(L + W - R) / 2}" y="${H - 8}" fill="#b8c6ca" font-size="12" text-anchor="middle">${esc(o.xlabel)}</text>`);
  if (o.ylabel) g.push(`<text transform="translate(14 ${(T + H - B) / 2}) rotate(-90)" fill="#b8c6ca" font-size="12" text-anchor="middle">${esc(o.ylabel)}</text>`);
  const named = series.filter(s => s.name);
  named.forEach((s, k) => {
    const c = s.color || PLOT_COLORS[series.indexOf(s) % PLOT_COLORS.length];
    g.push(`<rect x="${W - R - 150}" y="${T + 8 + k * 16}" width="10" height="10" fill="${c}"/><text x="${W - R - 135}" y="${T + 17 + k * 16}" fill="#d3dde0" font-size="11">${esc(s.name)}</text>`);
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="Inter, system-ui, sans-serif">${g.join('')}</svg>`;
}

// Freedman–Diaconis bins (Sturges when the IQR is 0). Returns the bins and
// a bar plot.
export function histogram(data, o = {}) {
  const v = [...data].sort((a, b) => a - b), n = v.length;
  const q = (p) => { const h = (n - 1) * p, i = Math.floor(h); return v[i] + (h - i) * ((v[i + 1] ?? v[i]) - v[i]); };
  const lo = v[0], hi = v[n - 1], iqr = q(0.75) - q(0.25);
  let k = o.bins || (iqr > 0 ? Math.ceil((hi - lo) / (2 * iqr * n ** (-1 / 3))) : Math.ceil(Math.log2(n) + 1));
  k = Math.max(1, Math.min(200, k || 1));
  const w = (hi - lo) / k || 1, counts = new Array(k).fill(0);
  for (const x of v) counts[Math.min(k - 1, Math.floor((x - lo) / w))]++;
  const mids = counts.map((_, i) => lo + (i + 0.5) * w);
  return { lo, w, counts, svg: plot([{ x: mids, y: counts, type: 'bar', w, color: o.color }], { xlabel: o.xlabel || 'value', ylabel: 'count', h: o.h || 260, vlines: o.vlines, title: o.title }) };
}

// A horizontal box plot (whiskers to the last point within 1.5 IQR).
export function boxplot(s, o = {}) {
  const W = o.w || 640, H = 110, L = 64, R = 16;
  const x0 = s.min, x1 = s.max === s.min ? s.min + 1 : s.max;
  const pad = (x1 - x0) * 0.05;
  const px = (x) => L + (x - (x0 - pad)) / (x1 - x0 + 2 * pad) * (W - L - R);
  const iqr = s.q3 - s.q1, wl = s.sorted.find(x => x >= s.q1 - 1.5 * iqr), wh = [...s.sorted].reverse().find(x => x <= s.q3 + 1.5 * iqr);
  const out = s.sorted.filter(x => x < wl || x > wh);
  const y = 50, g = [`<rect width="${W}" height="${H}" fill="#0b1014"/>`];
  for (const t of ticks(x0 - pad, x1 + pad, 7)) g.push(`<line x1="${px(t).toFixed(1)}" x2="${px(t).toFixed(1)}" y1="14" y2="82" stroke="#1d2a2f"/><text x="${px(t).toFixed(1)}" y="98" fill="#8fa3a8" font-size="11" text-anchor="middle">${tickText(t)}</text>`);
  g.push(`<line x1="${px(wl)}" x2="${px(wh)}" y1="${y}" y2="${y}" stroke="#8fa3a8"/>`);
  g.push(`<line x1="${px(wl)}" x2="${px(wl)}" y1="${y - 10}" y2="${y + 10}" stroke="#8fa3a8"/><line x1="${px(wh)}" x2="${px(wh)}" y1="${y - 10}" y2="${y + 10}" stroke="#8fa3a8"/>`);
  g.push(`<rect x="${px(s.q1)}" y="${y - 18}" width="${Math.max(1, px(s.q3) - px(s.q1))}" height="36" fill="#62c4ff" fill-opacity="0.25" stroke="#62c4ff"/>`);
  g.push(`<line x1="${px(s.median)}" x2="${px(s.median)}" y1="${y - 18}" y2="${y + 18}" stroke="#ffd666" stroke-width="2"/>`);
  g.push(`<path d="M${px(s.mean) - 5} ${y}L${px(s.mean)} ${y - 5}L${px(s.mean) + 5} ${y}L${px(s.mean)} ${y + 5}Z" fill="#ff9a62"/>`);
  for (const x of out) g.push(`<circle cx="${px(x).toFixed(1)}" cy="${y}" r="3" fill="none" stroke="#e889dc"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="Inter, system-ui, sans-serif">${g.join('')}</svg>`;
}

// Evenly spaced numbers.
export const linspace = (a, b, n) => Array.from({ length: n }, (_, i) => a + (b - a) * i / (n - 1));
