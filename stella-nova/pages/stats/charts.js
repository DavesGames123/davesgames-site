// ============================================================================
//  CHARTS  ·  pages/stats/charts.js — small SVG and HTML charts for #stats
// ----------------------------------------------------------------------------
//  No chart library. Each function fills one element and gives every mark a
//  hover tooltip (one shared #tip element). Colours come from CSS tokens in
//  style.css: --s1..--s3 categorical (validated, dark mode, on --card),
//  --q1..--q5 a one-hue ordinal ramp, --good --warn --bad status.
//
//    lineChart   daily series on one axis, crosshair + tooltip
//    columns     vertical bars for an ordered set (histograms, hours)
//    barList     ranked horizontal bars in HTML, with a share column
//    heat        weekday x hour matrix
//    stack100    one 100% bar per row (WebGPU by browser)
//    worldMap    choropleth on a Natural Earth I projection
//
//  grep -n targets: "export function lineChart", "export function worldMap",
//                   "function tipShow"
// ============================================================================

export const fmt = n => (n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(0) + 'k' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(Math.round(n)));
export const fmtInt = n => Math.round(n).toLocaleString('en-US');
export const pct = (a, b) => (b ? (100 * a / b).toFixed(a / b < 0.1 ? 1 : 0) + '%' : '–');
export const dur = s => (!isFinite(s) ? '–' : s < 60 ? Math.round(s) + 's' : s < 3600 ? Math.floor(s / 60) + 'm ' + String(Math.round(s % 60)).padStart(2, '0') + 's' : (s / 3600).toFixed(1) + 'h');
export const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const NS = 'http://www.w3.org/2000/svg';

// ── tooltip ─────────────────────────────────────────────────────────────
let tip;
function tipShow(ev, html) {
  if (!tip) { tip = document.createElement('div'); tip.id = 'tip'; document.body.appendChild(tip); }
  tip.innerHTML = html;
  tip.hidden = false;
  const r = tip.getBoundingClientRect(), pad = 14;
  let x = ev.clientX + pad, y = ev.clientY + pad;
  if (x + r.width > innerWidth - 8) x = ev.clientX - r.width - pad;
  if (y + r.height > innerHeight - 8) y = ev.clientY - r.height - pad;
  tip.style.transform = `translate(${Math.max(8, x)}px, ${Math.max(8, y)}px)`;
}
function tipHide() { if (tip) tip.hidden = true; }
export function hoverTip(el, html) {
  el.addEventListener('pointermove', e => tipShow(e, typeof html === 'function' ? html(e) : html));
  el.addEventListener('pointerleave', tipHide);
}
export function empty(el, text = 'No data in this range yet.') { el.innerHTML = `<p class="empty">${esc(text)}</p>`; }

function svg(w, h, cls) {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', `0 0 ${w} ${h}`);
  s.setAttribute('class', cls || 'chart');
  s.setAttribute('role', 'img');
  return s;
}
function node(tag, attrs, parent) {
  const n = document.createElementNS(NS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(n);
  return n;
}
function niceMax(v) {
  if (v <= 0) return 4;
  const p = Math.pow(10, Math.floor(Math.log10(v))), f = v / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}

// ── lineChart ───────────────────────────────────────────────────────────
// opt = { x: [labels], xFmt(label) -> short text, series: [{ name, color, values }],
//         valueFmt, area: index of the series to fill (or -1), height }
export function lineChart(el, opt) {
  const W = Math.max(320, el.clientWidth || 640), H = opt.height || 240;
  const L = 44, R = 12, T = 12, B = 26, n = opt.x.length;
  const max = niceMax(Math.max(1, ...opt.series.flatMap(s => s.values)));
  const X = i => L + (n <= 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (n - 1));
  const Y = v => T + (H - T - B) * (1 - v / max);
  const s = svg(W, H);
  s.setAttribute('aria-label', opt.series.map(x => x.name).join(', ') + ' by day');
  for (let k = 0; k <= 4; k++) {
    const v = (max * k) / 4, y = Y(v);
    node('line', { x1: L, x2: W - R, y1: y, y2: y, class: k ? 'grid' : 'axis' }, s);
    node('text', { x: L - 8, y: y + 4, class: 'tick', 'text-anchor': 'end' }, s).textContent = fmt(v);
  }
  const step = Math.max(1, Math.ceil(n / Math.max(2, Math.floor((W - L - R) / 78))));
  for (let i = 0; i < n; i += step) node('text', { x: X(i), y: H - 6, class: 'tick', 'text-anchor': 'middle' }, s).textContent = opt.xFmt ? opt.xFmt(opt.x[i]) : opt.x[i];
  opt.series.forEach((ser, si) => {
    const pts = ser.values.map((v, i) => [X(i), Y(v)]);
    if (si === opt.area && n > 1) node('path', { d: `M${pts[0][0]},${Y(0)}L${pts.map(p => p.join(',')).join('L')}L${pts[n - 1][0]},${Y(0)}Z`, fill: ser.color, opacity: 0.12 }, s);
    if (n > 1) node('path', { d: 'M' + pts.map(p => p.join(',')).join('L'), fill: 'none', stroke: ser.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, s);
    if (n === 1 || (W - L - R) / (n - 1) >= 12) pts.forEach(p => node('circle', { cx: p[0], cy: p[1], r: n <= 1 ? 4 : 2.5, fill: ser.color, stroke: 'var(--card)', 'stroke-width': 2 }, s));
  });
  const cross = node('line', { y1: T, y2: H - B, class: 'cross', visibility: 'hidden' }, s);
  const hit = node('rect', { x: L, y: T, width: W - L - R, height: H - T - B, fill: 'transparent' }, s);
  hit.addEventListener('pointermove', e => {
    const r = s.getBoundingClientRect(), px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.max(0, Math.min(n - 1, Math.round(((px - L) / (W - L - R)) * (n - 1))));
    cross.setAttribute('x1', X(i)); cross.setAttribute('x2', X(i)); cross.setAttribute('visibility', 'visible');
    tipShow(e, `<b>${esc(opt.xFmt ? opt.xFmt(opt.x[i], true) : opt.x[i])}</b>` + opt.series.map(x =>
      `<div class="tl"><i style="background:${x.color}"></i>${esc(x.name)}<span>${(opt.valueFmt || fmtInt)(x.values[i])}</span></div>`).join(''));
  });
  hit.addEventListener('pointerleave', () => { cross.setAttribute('visibility', 'hidden'); tipHide(); });
  el.replaceChildren(s);
}

// ── columns ─────────────────────────────────────────────────────────────
// opt = { labels, values, color, valueFmt, tipFmt(i) -> html, height, every }
export function columns(el, opt) {
  const W = Math.max(280, el.clientWidth || 480), H = opt.height || 170;
  const L = 36, R = 6, T = 8, B = 24, n = opt.labels.length;
  const max = niceMax(Math.max(1, ...opt.values));
  const bw = (W - L - R) / n, gap = Math.min(6, bw * 0.25);
  const Y = v => T + (H - T - B) * (1 - v / max);
  const s = svg(W, H);
  [0, 0.5, 1].forEach((f, k) => {
    const y = Y(max * f);
    node('line', { x1: L, x2: W - R, y1: y, y2: y, class: k ? 'grid' : 'axis' }, s);
    node('text', { x: L - 6, y: y + 4, class: 'tick', 'text-anchor': 'end' }, s).textContent = fmt(max * f);
  });
  const every = opt.every || Math.max(1, Math.ceil(n / Math.floor((W - L - R) / 44)));
  opt.values.forEach((v, i) => {
    const x = L + i * bw + gap / 2, h = Math.max(0, Y(0) - Y(v));
    const g = node('g', {}, s);
    node('rect', { x: L + i * bw, y: T, width: bw, height: H - T - B, fill: 'transparent' }, g);
    if (h > 0) node('path', { d: roundTop(x, Y(v), bw - gap, h, Math.min(4, (bw - gap) / 2)), fill: opt.color }, g);
    if (i % every === 0) node('text', { x: x + (bw - gap) / 2, y: H - 7, class: 'tick', 'text-anchor': 'middle' }, s).textContent = opt.labels[i];
    hoverTip(g, () => (opt.tipFmt ? opt.tipFmt(i) : `<b>${esc(opt.labels[i])}</b><div class="tl">${(opt.valueFmt || fmtInt)(v)}</div>`));
  });
  el.replaceChildren(s);
}
function roundTop(x, y, w, h, r) {
  r = Math.min(r, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

// ── barList ─────────────────────────────────────────────────────────────
// rows = [{ label, n, sub, href }], opt = { color, total, valueFmt, limit, share }
export function barList(el, rows, opt = {}) {
  rows = rows.filter(r => r.n > 0).sort((a, b) => b.n - a.n);
  if (!rows.length) return empty(el);
  const limit = opt.limit || 10, shown = rows.slice(0, limit), rest = rows.slice(limit);
  const max = shown[0].n, total = opt.total || rows.reduce((s, r) => s + r.n, 0);
  const vf = opt.valueFmt || fmtInt;
  const li = r => {
    const w = Math.max(1.5, (100 * r.n) / max);
    const lab = r.href ? `<a href="${esc(r.href)}" target="_top">${esc(r.label)}</a>` : esc(r.label);
    return `<li data-tip="${esc(r.label)}|${esc(vf(r.n))}|${esc(pct(r.n, total))}"><span class="bl-l">${lab}${r.sub ? `<small>${esc(r.sub)}</small>` : ''}</span>` +
      `<span class="bl-b"><i style="width:${w}%;background:${opt.color || 'var(--s1)'}"></i></span>` +
      `<span class="bl-n">${vf(r.n)}</span>${opt.share === false ? '' : `<span class="bl-p">${pct(r.n, total)}</span>`}</li>`;
  };
  el.innerHTML = `<ol class="barlist">${shown.map(li).join('')}</ol>` +
    (rest.length ? `<details class="more"><summary>${rest.length} more</summary><ol class="barlist">${rest.map(li).join('')}</ol></details>` : '');
  el.querySelectorAll('li[data-tip]').forEach(n => {
    const [a, b, c] = n.dataset.tip.split('|');
    hoverTip(n, `<b>${a}</b><div class="tl">${b}<span>${c}</span></div>`);
  });
}

// ── heat ────────────────────────────────────────────────────────────────
// m[r][c] counts. rows/cols are labels. ramp: CSS colours low -> high.
export function heat(el, m, rows, cols, ramp, cellTip) {
  const W = Math.max(320, el.clientWidth || 640), L = 38, T = 4, B = 20;
  const cw = (W - L) / cols.length, ch = Math.min(26, Math.max(16, cw * 0.9)), H = T + rows.length * ch + B;
  const max = Math.max(1, ...m.flat());
  const s = svg(W, H);
  rows.forEach((rl, r) => {
    node('text', { x: L - 8, y: T + r * ch + ch / 2 + 4, class: 'tick', 'text-anchor': 'end' }, s).textContent = rl;
    cols.forEach((cl, c) => {
      const v = m[r][c], f = v / max;
      const fill = v ? ramp[Math.min(ramp.length - 1, Math.floor(Math.sqrt(f) * ramp.length))] : 'var(--cell0)';
      const rect = node('rect', { x: L + c * cw + 1, y: T + r * ch + 1, width: cw - 2, height: ch - 2, rx: 3, fill }, s);
      hoverTip(rect, cellTip(r, c, v));
    });
  });
  cols.forEach((cl, c) => { if (c % 3 === 0) node('text', { x: L + c * cw + cw / 2, y: H - 5, class: 'tick', 'text-anchor': 'middle' }, s).textContent = cl; });
  el.replaceChildren(s);
}

// ── stack100 ────────────────────────────────────────────────────────────
// rows = [{ label, parts: [{ name, n, color }] }]
export function stack100(el, rows) {
  rows = rows.filter(r => r.parts.some(p => p.n > 0));
  if (!rows.length) return empty(el);
  el.innerHTML = '<div class="stack">' + rows.map(r => {
    const t = r.parts.reduce((s, p) => s + p.n, 0);
    return `<div class="st-row"><span class="st-l">${esc(r.label)}<small>${fmtInt(t)}</small></span><span class="st-b">` +
      r.parts.filter(p => p.n).map(p => `<i style="flex:${p.n};background:${p.color}" data-tip="${esc(r.label)}|${esc(p.name)}|${fmtInt(p.n)}|${pct(p.n, t)}"></i>`).join('') +
      '</span></div>';
  }).join('') + '</div>';
  el.querySelectorAll('i[data-tip]').forEach(n => {
    const [a, b, c, d] = n.dataset.tip.split('|');
    hoverTip(n, `<b>${a}</b><div class="tl">${b}<span>${c} · ${d}</span></div>`);
  });
}

// ── worldMap ────────────────────────────────────────────────────────────
// features: GeoJSON features (numeric id). values: Map(id -> n).
// names: Map(id -> name). ramp: CSS colours low -> high.
function natEarth(lon, lat) {
  const l = (lon * Math.PI) / 180, p = (lat * Math.PI) / 180, p2 = p * p, p4 = p2 * p2;
  return [l * (0.8707 - 0.131979 * p2 + p4 * (-0.013791 + p4 * (0.003971 * p2 - 0.001529 * p4))),
    p * (1.007226 + p2 * (0.015085 + p4 * (-0.044475 + 0.028874 * p2 - 0.005916 * p4)))];
}
export function worldMap(el, features, values, names, ramp) {
  const W = 960, H = 470, sx = W / 5.5, cx = W / 2, cy = H / 2 - 18;
  const s = svg(W, H, 'chart map');
  s.setAttribute('aria-label', 'Visits by country');
  const max = Math.max(1, ...values.values());
  // A ring that crosses the 180 degree line (Russia, Fiji) is unwrapped
  // to run past the edge, and the sphere clip cuts it. Without this, the
  // jump from +180 to -180 draws a line across the whole map.
  const ring = (r, flat) => {
    let off = 0, prev = r[0][0];
    return 'M' + r.map(([lo, la]) => {
      if (!flat) { if (lo - prev > 180) off -= 360; else if (prev - lo > 180) off += 360; }
      prev = lo;
      const [x, y] = natEarth(lo + off, la);
      return (cx + x * sx).toFixed(1) + ',' + (cy - y * sx).toFixed(1);
    }).join('L') + 'Z';
  };
  // sphere outline, also the clip path
  const edge = [];
  for (let la = -90; la <= 90; la += 5) edge.push([180, la]);
  for (let la = 90; la >= -90; la -= 5) edge.push([-180, la]);
  const sphere = ring(edge, true);
  const cid = 'sph' + Math.random().toString(36).slice(2, 8);
  node('path', { d: sphere }, node('clipPath', { id: cid }, node('defs', {}, s)));
  node('path', { d: sphere, class: 'sphere' }, s);
  const land = node('g', { 'clip-path': `url(#${cid})` }, s);
  for (const f of features) {
    if (f.id === '010') continue; // Antarctica: no visitors, much area
    const g = f.geometry; if (!g) continue;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    const v = values.get(f.id) || 0;
    const k = v ? Math.min(ramp.length - 1, Math.floor((Math.log(v + 1) / Math.log(max + 1)) * ramp.length - 1e-9)) : -1;
    const p = node('path', { d: polys.map(pl => pl.map(ring).join('')).join(''), class: 'land' + (v ? ' on' : ''), fill: v ? ramp[Math.max(0, k)] : 'var(--land)' }, land);
    hoverTip(p, `<b>${esc(names.get(f.id) || f.properties.name)}</b><div class="tl">${v ? fmtInt(v) + ' visits' : 'no visits'}</div>`);
  }
  el.replaceChildren(s);
}
