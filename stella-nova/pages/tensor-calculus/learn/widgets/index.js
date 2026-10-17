// ============================================================================
//  TENSOR CALCULUS  ·  learn/widgets/index.js  ·  inline chapter widgets  (LEARN)
// ----------------------------------------------------------------------------
//  Small interactive figures inside a beat. Each one is SVG plus a few
//  controls. The numbers come from widgets/math.js (DOM-free, tested).
//  A widget that changes a parameter of the 3D scene calls
//  ctx.page.setScene(id, params), at most once per animation frame.
//
//  mountWidget(host, spec, ctx) -> { dispose() }
//    spec.type is one of refs.js WIDGETS. ctx = { page, tex(el, src,
//    display) (typeset with index colours), color(sym) ('#rrggbb'),
//    cls(sym) ('iN') }.
//
//  WIDGETS   (grep -n "^function w_" index.js)
//      w_basisDrag ....... drag e_1, e_2; v^i and w_i change, w_i v^i stays
//      w_stretch ......... x' = s x: arrows grow, plane stacks thin out
//      w_sumExpand ....... every term of an Einstein sum, for n = 2..4
//      w_quiz ............ mark the free indices, or "not valid"
//      w_raiseLower ...... edit g_ij; v_i = g_ij v^j as a plane stack
//      w_outerProduct .... drag bars of u and w; the u^i w_j block follows
//      w_rotateRank2 ..... rotate the frame; T'_ij change, trace and det stay
//      w_count ........... independent components by formula and by solving
//      w_christoffelPolar  how e_r and e_theta change with r and theta
//      w_holonomy ........ transport round a latitude; angle = area
//      w_notation ........ one statement in four notations
// ============================================================================
import * as W from './math.js';

const NS = 'http://www.w3.org/2000/svg';
function s(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}
function h(tag, attrs = {}, parent, text) {
  const e = document.createElement(tag);
  for (const k in attrs) {
    if (k === 'class') e.className = attrs[k];
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), attrs[k]);
    else e.setAttribute(k, attrs[k]);
  }
  if (text != null) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}
const f2 = x => (Math.abs(x) < 5e-3 ? 0 : x).toFixed(2);
const DEG = 180 / Math.PI;

// One scene update per frame, whatever the input rate.
function sceneSender(ctx, id) {
  let pending = null, raf = 0;
  const flush = () => { raf = 0; if (pending && ctx.page && ctx.page.setScene) ctx.page.setScene(id, pending); pending = null; };
  return p => {
    pending = p;
    if (!raf) raf = (typeof requestAnimationFrame === 'function' ? requestAnimationFrame : f => setTimeout(f, 16))(flush);
  };
}

function svgBox(host, w, hgt, label) {
  const svg = s('svg', { viewBox: `0 0 ${w} ${hgt}`, class: 'lw-svg', role: 'img', 'aria-label': label }, host);
  return svg;
}

function arrowHead(svg, id, color) {
  let defs = svg.querySelector('defs') || s('defs', {}, svg);
  const m = s('marker', { id, viewBox: '0 0 10 10', refX: 8.5, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, defs);
  s('path', { d: 'M0,0 L10,5 L0,10 z', fill: color }, m);
  return `url(#${id})`;
}
let uid = 0;

// Readout rows: [[html label, value, cls]]
function readout(host) {
  const box = h('div', { class: 'lw-read' }, host);
  return rows => { box.innerHTML = rows.map(([l, v, extra]) => `<span class="lw-cell${extra ? ' ' + extra : ''}"><span class="lw-l">${l}</span><span class="lw-v">${v}</span></span>`).join(''); };
}
const sym = (base, idx, up, cls) => `<i>${base}</i><${up ? 'sup' : 'sub'} class="${cls}">${idx}</${up ? 'sup' : 'sub'}>`;

function dragger(svg, toWorld, onMove) {
  let active = null;
  const pt = ev => { const r = svg.getBoundingClientRect(); const vb = svg.viewBox.baseVal; return toWorld((ev.clientX - r.left) * vb.width / r.width, (ev.clientY - r.top) * vb.height / r.height); };
  const down = (key) => ev => { active = key; svg.setPointerCapture && svg.setPointerCapture(ev.pointerId); ev.preventDefault(); };
  svg.addEventListener('pointermove', ev => { if (active) { onMove(active, pt(ev)); ev.preventDefault(); } });
  const up = () => { active = null; };
  svg.addEventListener('pointerup', up); svg.addEventListener('pointercancel', up);
  return down;
}

function slider(host, { label, min, max, step, value, cls = '', fmt = f2 }, onInput) {
  const row = h('label', { class: 'lw-slider' }, host);
  const l = h('span', { class: 'lw-sl ' + cls }, row); l.innerHTML = label;
  const inp = h('input', { type: 'range', min, max, step, value }, row);
  const out = h('span', { class: 'lw-sv' }, row, fmt(+value));
  inp.addEventListener('input', () => { out.textContent = fmt(+inp.value); onInput(+inp.value); });
  return inp;
}

// ------------------------------------------------------------ basis drag
function w_basisDrag(host, spec, ctx) {
  const W0 = 300, H0 = 240, S = 46, ox = W0 / 2, oy = H0 / 2 + 10;
  const svg = svgBox(host, W0, H0, 'Drag the basis vectors');
  const X = x => ox + x * S, Y = y => oy - y * S;
  const v = spec.v || [1.4, 0.9], w = spec.w || [0.7, -0.4];
  let E = [[1, 0.3], [0, 1]];         // columns e1, e2
  const ci = ctx.color('i'), cj = ctx.color('j');
  const planes = s('g', { class: 'lw-planes' }, svg);
  const mV = arrowHead(svg, 'lwv' + (++uid), '#eceef2');
  const m1 = arrowHead(svg, 'lw1' + uid, ci), m2 = arrowHead(svg, 'lw2' + uid, cj);
  const vLine = s('line', { x1: X(0), y1: Y(0), stroke: '#eceef2', 'stroke-width': 2.4, 'marker-end': mV }, svg);
  const e1 = s('line', { x1: X(0), y1: Y(0), stroke: ci, 'stroke-width': 2.2, 'marker-end': m1 }, svg);
  const e2 = s('line', { x1: X(0), y1: Y(0), stroke: cj, 'stroke-width': 2.2, 'marker-end': m2 }, svg);
  const h1 = s('circle', { r: 11, fill: ci, 'fill-opacity': 0.25, stroke: ci, class: 'lw-handle' }, svg);
  const h2 = s('circle', { r: 11, fill: cj, 'fill-opacity': 0.25, stroke: cj, class: 'lw-handle' }, svg);
  const tv = s('text', { class: 'lw-lab' }, svg); tv.textContent = 'v';
  const t1 = s('text', { class: 'lw-lab', fill: ci }, svg); t1.textContent = 'e₁';
  const t2 = s('text', { class: 'lw-lab', fill: cj }, svg); t2.textContent = 'e₂';
  const read = readout(host);
  const wn = Math.hypot(w[0], w[1]);
  // The covector's level lines w.x = k, k integer, are fixed in the plane.
  for (let k = -6; k <= 6; k++) {
    const px = w[0] * k / (wn * wn), py = w[1] * k / (wn * wn), dx = -w[1] / wn * 6, dy = w[0] / wn * 6;
    s('line', { x1: X(px - dx), y1: Y(py - dy), x2: X(px + dx), y2: Y(py + dy), class: k ? 'lw-plane' : 'lw-plane lw-plane0' }, planes);
  }
  vLine.setAttribute('x2', X(v[0])); vLine.setAttribute('y2', Y(v[1]));
  tv.setAttribute('x', X(v[0]) + 6); tv.setAttribute('y', Y(v[1]) - 6);
  const draw = () => {
    for (const [ln, hd, lab, k] of [[e1, h1, t1, 0], [e2, h2, t2, 1]]) {
      const x = E[0][k], y = E[1][k];
      ln.setAttribute('x2', X(x)); ln.setAttribute('y2', Y(y));
      hd.setAttribute('cx', X(x)); hd.setAttribute('cy', Y(y));
      lab.setAttribute('x', X(x) + 9); lab.setAttribute('y', Y(y) + 14);
    }
    let c;
    try { c = W.basisComponents(E, v, w); } catch { read([['basis', 'degenerate: the two arrows are parallel']]); return; }
    read([
      [sym('v', 1, true, ctx.cls('i')), f2(c.up[0])], [sym('v', 2, true, ctx.cls('j')), f2(c.up[1])],
      [sym('ω', 1, false, ctx.cls('i')), f2(c.down[0])], [sym('ω', 2, false, ctx.cls('j')), f2(c.down[1])],
      ['<i>ω</i><sub>i</sub><i>v</i><sup>i</sup>', f2(c.pairing), 'lw-inv'],
    ]);
  };
  const down = dragger(svg, (px, py) => [(px - ox) / S, (oy - py) / S], (key, p) => {
    const k = key === 'e1' ? 0 : 1;
    const len = Math.hypot(p[0], p[1]);
    if (len < 0.25) { p = [p[0] / len * 0.25 || 0.25, p[1] / len * 0.25 || 0]; }
    E[0][k] = p[0]; E[1][k] = p[1];
    if (Math.abs(W.det(E)) < 0.05) { E[0][k] -= p[0] * 0.02; }
    draw();
  });
  h1.addEventListener('pointerdown', down('e1')); h2.addEventListener('pointerdown', down('e2'));
  h('p', { class: 'lw-note' }, host, 'Drag the coloured dots. The white arrow v and the grey level lines of ω never move.');
  draw();
  return {};
}

// ------------------------------------------------------------ stretch
function w_stretch(host, spec, ctx) {
  const W0 = 300, H0 = 200, S = 56, ox = 40, oy = H0 - 34;
  const svg = svgBox(host, W0, H0, 'Stretch the coordinate ruler');
  const X = x => ox + x * S, Y = y => oy - y * S;
  const v = spec.v || [1.2, 0.8], w = spec.w || [0.9, 0.5];
  const send = sceneSender(ctx, 'upper-lower');
  const g = s('g', {}, svg);
  const read = readout(host);
  const ci = ctx.color('i');
  const mE = arrowHead(svg, 'lse' + (++uid), ci), mV = arrowHead(svg, 'lsv' + uid, '#eceef2');
  const draw = sc => {
    g.replaceChildren();
    const wn = Math.hypot(w[0], w[1]);
    for (let k = 1; k <= 8; k++) {
      const px = w[0] * k / (wn * wn) * 0.5, py = w[1] * k / (wn * wn) * 0.5, dx = -w[1] / wn * 4, dy = w[0] / wn * 4;
      s('line', { x1: X(px - dx), y1: Y(py - dy), x2: X(px + dx), y2: Y(py + dy), class: 'lw-plane' }, g);
    }
    // ruler ticks: one tick per new coordinate unit (length 1/s)
    for (let k = 0; k * (1 / sc) <= 4.6; k++) s('line', { x1: X(k / sc), y1: Y(0) + 2, x2: X(k / sc), y2: Y(0) + (k % 5 ? 7 : 12), class: 'lw-tick' }, g);
    for (let k = 0; k * (1 / sc) <= 2.8; k++) s('line', { x1: X(0) - 2, y1: Y(k / sc), x2: X(0) - (k % 5 ? 7 : 12), y2: Y(k / sc), class: 'lw-tick' }, g);
    s('line', { x1: X(0), y1: Y(0), x2: X(1 / sc), y2: Y(0), stroke: ci, 'stroke-width': 2.4, 'marker-end': mE }, g);
    s('line', { x1: X(0), y1: Y(0), x2: X(0), y2: Y(1 / sc), stroke: ctx.color('j'), 'stroke-width': 2.4, 'marker-end': mE }, g);
    s('line', { x1: X(0), y1: Y(0), x2: X(v[0]), y2: Y(v[1]), stroke: '#eceef2', 'stroke-width': 2.4, 'marker-end': mV }, g);
    const c = W.stretchComponents(sc, v, w);
    read([
      [sym('v', "'1", true, ctx.cls('i')), f2(c.up[0])], [sym('v', "'2", true, ctx.cls('j')), f2(c.up[1])],
      [sym('ω', "'1", false, ctx.cls('i')), f2(c.down[0])], [sym('ω', "'2", false, ctx.cls('j')), f2(c.down[1])],
      ['<i>ω</i>′<sub>i</sub><i>v</i>′<sup>i</sup>', f2(c.pairing), 'lw-inv'],
    ]);
    send({ s: sc });
  };
  slider(host, { label: 'ruler factor <i>s</i>', min: 0.45, max: 2.2, step: 0.01, value: 1 }, draw);
  h('p', { class: 'lw-note' }, host, 'Each tick is one unit of the new coordinate. More ticks per arrow: bigger upper components. More ticks between planes: smaller lower components.');
  draw(1);
  return {};
}

// ------------------------------------------------------------ sum expander
export const VALUE_PRESETS = {
  delta: { delta: (i, j) => (i === j ? 1 : 0), v: i => [3, 1, 4, 1][i] },
};

function w_sumExpand(host, spec, ctx) {
  const factors = W.parseFactors(spec.src);
  const bar = h('div', { class: 'lw-row' }, host);
  h('span', { class: 'lw-sl' }, bar, 'dimension n');
  const sel = h('select', { 'aria-label': 'dimension' }, bar);
  for (const n of [2, 3, 4]) { const o = h('option', { value: n }, sel, String(n)); if (n === (spec.n || 3)) o.selected = true; }
  const head = h('div', { class: 'lw-count' }, host);
  const out = h('div', { class: 'lw-eq sci-eq' }, host);
  const draw = () => {
    const n = +sel.value;
    const values = spec.values ? VALUE_PRESETS[spec.values] : null;
    const r = W.expandEinstein(factors, n, { classOf: ctx.cls, values });
    const tex = expandTex(r, ctx);
    head.textContent = `${r.free.length ? `${r.lines.length} component${r.lines.length > 1 ? 's' : ''} (free: ${r.free.join(', ')})` : 'one number (no free index)'}, ${r.termsPerLine} term${r.termsPerLine > 1 ? 's' : ''} each (summed: ${r.dummy.join(', ') || 'none'}), ${r.count} products in all.`;
    ctx.tex(out, tex, true);
  };
  sel.addEventListener('change', draw);
  draw();
  return {};
}

// The TeX of an expansion: at most maxLines lines and maxTerms terms per
// line (the middle terms become \cdots), so MathJax stays inside its TeX
// buffer. Shared with the tests.
export function expandTex(r, ctx, maxLines = 6, maxTerms = 8) {
  const lines = r.lines.slice(0, maxLines).map(l => {
    const lhs = Object.entries(l.assign).map(([sy, v]) => `${sy.length > 1 ? '\\' + sy : sy}=${v}`).join(',\\ ');
    const val = l.value != null ? ` = ${r.fmt(l.value)}` : '';
    const terms = l.terms.length > maxTerms ? [...l.terms.slice(0, maxTerms - 2), '\\cdots', l.terms[l.terms.length - 1]] : l.terms;
    return (lhs ? `\\I{${lhs}}:\\ \\ ` : '') + '&' + terms.join(' + ') + val;
  });
  if (r.lines.length > maxLines) lines.push(`&\\text{and ${r.lines.length - maxLines} more lines}`);
  return `\\begin{aligned}${lines.join('\\\\')}\\end{aligned}`;
}

// ------------------------------------------------------------ quiz
export function quizAnswer(src) {
  const sides = W.parseSides(src);
  const c = W.checkEquation(sides);
  const all = [];
  for (const t of sides) for (const f of t) for (const ix of f.idx) if (!all.includes(ix.sym)) all.push(ix.sym);
  return { ok: c.ok, free: c.ok ? c.free.map(f => f.sym) : null, syms: all, why: quizWhy(c) };
}
function quizWhy(c) {
  if (c.errors.length) return c.errors.map(e => `${e.sym} appears ${e.why} in one term`).join('; ') + ', so the expression breaks the summation rule.';
  if (!c.balanced) return 'The terms do not have the same free indices, so the two sides cannot be equal in every basis.';
  const d = [...new Set(c.terms.flatMap(t => t.dummy))];
  return (d.length ? `${d.join(', ')}: once up and once down, summed. ` : '') + (c.free.length ? `${c.free.map(f => f.sym).join(', ')}: once per term, free.` : 'No free index: the result is a scalar.');
}

function w_quiz(host, spec, ctx) {
  const list = h('ol', { class: 'lw-quiz' }, host);
  for (const item of spec.items) {
    const ans = quizAnswer(item.src);
    const li = h('li', {}, list);
    const eq = h('span', { class: 'lw-qeq sci-sym' }, li);
    ctx.tex(eq, item.src, false);
    const chips = h('span', { class: 'lw-chips' }, li);
    const picked = new Set();
    const mk = (label, key, cls) => {
      const b = h('button', { type: 'button', class: 'lw-chip ' + (cls || ''), 'aria-pressed': 'false' }, chips);
      b.innerHTML = label;
      b.addEventListener('click', () => {
        if (key === '!') { picked.clear(); chips.querySelectorAll('.lw-chip').forEach(x => x.setAttribute('aria-pressed', 'false')); }
        else picked.delete('!');
        if (picked.has(key)) picked.delete(key); else picked.add(key);
        if (key !== '!') chips.querySelector('.lw-bad').setAttribute('aria-pressed', 'false');
        b.setAttribute('aria-pressed', picked.has(key) ? 'true' : 'false');
        fb.textContent = ''; li.classList.remove('right', 'wrong');
      });
    };
    for (const sy of ans.syms) mk(greekName(sy), sy, ctx.cls(sy));
    mk('not valid', '!', 'lw-bad');
    const check = h('button', { type: 'button', class: 'lw-check' }, li, 'Check');
    const fb = h('span', { class: 'lw-fb' }, li);
    check.addEventListener('click', () => {
      const right = ans.ok ? (!picked.has('!') && picked.size === ans.free.length && ans.free.every(x => picked.has(x))) : picked.has('!');
      li.classList.toggle('right', right); li.classList.toggle('wrong', !right);
      fb.textContent = (right ? 'Right. ' : 'Not quite. ') + ans.why;
    });
  }
  return {};
}
const GREEK = { alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', mu: 'μ', nu: 'ν', rho: 'ρ', sigma: 'σ', lambda: 'λ', kappa: 'κ', tau: 'τ', theta: 'θ', phi: 'φ' };
const greekName = sy => GREEK[sy] || sy;

// ------------------------------------------------------------ raise / lower
function w_raiseLower(host, spec, ctx) {
  const W0 = 300, H0 = 230, S = 52, ox = W0 / 2, oy = H0 / 2;
  const svg = svgBox(host, W0, H0, 'Lower an index with the metric');
  const X = x => ox + x * S, Y = y => oy - y * S;
  const v = spec.v || [1, 0.6];
  const g = s('g', {}, svg);
  const mV = arrowHead(svg, 'lrv' + (++uid), '#eceef2');
  const read = readout(host);
  let G = [[1, 0], [0, 1]];
  const draw = () => {
    g.replaceChildren();
    // unit circle of the metric: g_ij x^i x^j = 1
    const pts = [];
    for (let k = 0; k <= 72; k++) {
      const a = k / 72 * 2 * Math.PI, d = [Math.cos(a), Math.sin(a)];
      const q = G[0][0] * d[0] * d[0] + 2 * G[0][1] * d[0] * d[1] + G[1][1] * d[1] * d[1];
      const r = 1 / Math.sqrt(q);
      pts.push(`${X(d[0] * r)},${Y(d[1] * r)}`);
    }
    s('polygon', { points: pts.join(' '), class: 'lw-ellipse' }, g);
    const low = W.lowerIndex(G, v);
    const ln = Math.hypot(low[0], low[1]);
    for (let k = -5; k <= 5; k++) {
      const px = low[0] * k / (ln * ln), py = low[1] * k / (ln * ln), dx = -low[1] / ln * 5, dy = low[0] / ln * 5;
      s('line', { x1: X(px - dx), y1: Y(py - dy), x2: X(px + dx), y2: Y(py + dy), class: k === 1 ? 'lw-plane lw-plane1' : 'lw-plane', stroke: ctx.color('i') }, g);
    }
    s('line', { x1: X(0), y1: Y(0), x2: X(v[0]), y2: Y(v[1]), stroke: '#eceef2', 'stroke-width': 2.4, 'marker-end': mV }, g);
    read([
      [sym('v', 1, true, ctx.cls('j')), f2(v[0])], [sym('v', 2, true, ctx.cls('j')), f2(v[1])],
      [sym('v', 1, false, ctx.cls('i')), f2(low[0])], [sym('v', 2, false, ctx.cls('i')), f2(low[1])],
      ['|<i>v</i>|', f2(W.metricLength(G, v)), 'lw-inv'],
    ]);
  };
  const lim = () => 0.92 * Math.sqrt(G[0][0] * G[1][1]);
  slider(host, { label: '<i>g</i><sub>11</sub>', min: 0.3, max: 3, step: 0.01, value: 1 }, x => { G[0][0] = x; G[0][1] = Math.max(-lim(), Math.min(lim(), G[0][1])); G[1][0] = G[0][1]; draw(); });
  slider(host, { label: '<i>g</i><sub>12</sub>', min: -0.9, max: 0.9, step: 0.01, value: 0 }, x => { G[0][1] = G[1][0] = Math.max(-lim(), Math.min(lim(), x)); draw(); });
  slider(host, { label: '<i>g</i><sub>22</sub>', min: 0.3, max: 3, step: 0.01, value: 1 }, x => { G[1][1] = x; G[0][1] = Math.max(-lim(), Math.min(lim(), G[0][1])); G[1][0] = G[0][1]; draw(); });
  h('p', { class: 'lw-note' }, host, 'The ellipse holds the arrows of length 1 for this metric. The lines are the level sets of v_i, and the bright one is v_i x^i = 1. They are parallel to the tangent of the ellipse where the arrow v crosses it: the metric decides which direction is perpendicular to v.');
  draw();
  return {};
}

// ------------------------------------------------------------ outer product
function w_outerProduct(host, spec, ctx) {
  const u = (spec.u || [1, 2, -1]).slice(), w = (spec.w || [0.5, -1, 2]).slice();
  const n = u.length, C = 40, W0 = 70 + n * C + 10, H0 = 70 + n * C + 10;
  const svg = svgBox(host, W0, H0, 'Outer product of u and omega');
  const cells = [], uBars = [], wBars = [], texts = [];
  const ox = 70, oy = 70, MAX = 3;
  const ci = ctx.color('i'), cj = ctx.color('j');
  for (let i = 0; i < n; i++) {
    uBars.push(s('rect', { class: 'lw-bar', fill: ci, x: 4, y: oy + i * C + 6, height: C - 12 }, svg));
    wBars.push(s('rect', { class: 'lw-bar', fill: cj, y: 4, x: ox + i * C + 6, width: C - 12 }, svg));
    for (let j = 0; j < n; j++) {
      cells.push(s('rect', { x: ox + j * C + 1, y: oy + i * C + 1, width: C - 2, height: C - 2, rx: 3 }, svg));
      texts.push(s('text', { x: ox + j * C + C / 2, y: oy + i * C + C / 2 + 4, class: 'lw-cellt', 'text-anchor': 'middle' }, svg));
    }
  }
  const col = x => { const a = Math.min(1, Math.abs(x) / 4); return x >= 0 ? `rgba(86,180,233,${0.15 + 0.7 * a})` : `rgba(255,111,74,${0.15 + 0.7 * a})`; };
  const draw = () => {
    for (let i = 0; i < n; i++) {
      const L = Math.abs(u[i]) / MAX * 30;
      uBars[i].setAttribute('width', Math.max(2, L)); uBars[i].setAttribute('x', u[i] >= 0 ? 34 : 34 - L);
      const M = Math.abs(w[i]) / MAX * 30;
      wBars[i].setAttribute('height', Math.max(2, M)); wBars[i].setAttribute('y', w[i] >= 0 ? 34 - M : 34);
      for (let j = 0; j < n; j++) { const x = u[i] * w[j]; cells[i * n + j].setAttribute('fill', col(x)); texts[i * n + j].textContent = f2(x); }
    }
  };
  const down = dragger(svg, (px, py) => [px, py], (key, p) => {
    const [kind, k] = key.split(':');
    if (kind === 'u') u[+k] = Math.max(-MAX, Math.min(MAX, (p[0] - 34) / 30 * MAX));
    else w[+k] = Math.max(-MAX, Math.min(MAX, (34 - p[1]) / 30 * MAX));
    draw();
  });
  uBars.forEach((b, k) => b.addEventListener('pointerdown', down('u:' + k)));
  wBars.forEach((b, k) => b.addEventListener('pointerdown', down('w:' + k)));
  h('p', { class: 'lw-note' }, host, 'Drag the bars: the left column is u^i (rows), the top row is ω_j (columns). Each cell is u^i ω_j.');
  draw();
  return {};
}

// ------------------------------------------------------------ rotate rank 2
function w_rotateRank2(host, spec, ctx) {
  const T = spec.T || [[2, 0.6], [0.6, 1]];
  const W0 = 300, H0 = 220, S = 60, ox = 110, oy = H0 / 2;
  const svg = svgBox(host, W0, H0, 'Rotate the frame under a fixed tensor');
  const X = x => ox + x * S, Y = y => oy - y * S;
  const pts = [];
  for (let k = 0; k <= 72; k++) {
    const a = k / 72 * 2 * Math.PI, d = [Math.cos(a), Math.sin(a)];
    const q = T[0][0] * d[0] * d[0] + 2 * T[0][1] * d[0] * d[1] + T[1][1] * d[1] * d[1];
    const r = q > 0 ? 1 / Math.sqrt(q) : 2;
    pts.push(`${X(d[0] * r)},${Y(d[1] * r)}`);
  }
  s('polygon', { points: pts.join(' '), class: 'lw-ellipse' }, svg);
  const m1 = arrowHead(svg, 'lr1' + (++uid), ctx.color('i')), m2 = arrowHead(svg, 'lr2' + uid, ctx.color('j'));
  const a1 = s('line', { x1: X(0), y1: Y(0), stroke: ctx.color('i'), 'stroke-width': 2.2, 'marker-end': m1 }, svg);
  const a2 = s('line', { x1: X(0), y1: Y(0), stroke: ctx.color('j'), 'stroke-width': 2.2, 'marker-end': m2 }, svg);
  const mat = s('text', { x: 222, y: 70, class: 'lw-mat' }, svg);
  const read = readout(host);
  const send = sceneSender(ctx, 'transform-rank2');
  const draw = ang => {
    const R = W.rotation2(ang);
    a1.setAttribute('x2', X(R[0][0] * 1.4)); a1.setAttribute('y2', Y(R[1][0] * 1.4));
    a2.setAttribute('x2', X(R[0][1] * 1.4)); a2.setAttribute('y2', Y(R[1][1] * 1.4));
    const Tp = W.rotateRank2(T, ang);
    mat.replaceChildren();
    [[0, 0], [0, 1], [1, 0], [1, 1]].forEach(([i, j]) => {
      const tt = s('tspan', { x: 222 + j * 40, y: 70 + i * 26 }, mat); tt.textContent = f2(Tp[i][j]);
    });
    read([
      ["<i>T</i>′<sub>11</sub>", f2(Tp[0][0])], ["<i>T</i>′<sub>12</sub>", f2(Tp[0][1])], ["<i>T</i>′<sub>22</sub>", f2(Tp[1][1])],
      ['trace', f2(Tp[0][0] + Tp[1][1]), 'lw-inv'], ['det', f2(W.det(Tp)), 'lw-inv'],
    ]);
    send({ angle: ang });
  };
  slider(host, { label: 'frame angle', min: -3.14, max: 3.14, step: 0.01, value: 0, fmt: x => Math.round(x * DEG) + '°' }, draw);
  draw(0);
  return {};
}

// ------------------------------------------------------------ count
export const BRUTE_LIMIT = 256;
function w_count(host, spec, ctx) {
  const bar = h('div', { class: 'lw-row' }, host);
  const mkSel = (label, opts, val) => {
    h('span', { class: 'lw-sl' }, bar, label);
    const sl = h('select', { 'aria-label': label }, bar);
    for (const o of opts) { const op = h('option', { value: o }, sl, String(o)); if (String(o) === String(val)) op.selected = true; }
    return sl;
  };
  const sn = mkSel('n', [1, 2, 3, 4, 5, 6], spec.n || 3);
  const sr = mkSel('rank', [1, 2, 3, 4, 5], spec.r || 2);
  const sk = mkSel('symmetry', W.COUNT_KINDS, spec.kind || 'symmetric');
  const out = h('div', { class: 'lw-count' }, host);
  const grid = h('div', { class: 'lw-grid' }, host);
  const draw = () => {
    const n = +sn.value, kind = sk.value;
    if (kind === 'riemann') sr.value = '4';
    const r = +sr.value;
    const f = W.countComponents(n, r, kind);
    const N = n ** r;
    const brute = N <= BRUTE_LIMIT ? W.bruteCount(n, r, kind) : null;
    out.textContent = `${f} independent of ${N} components` + (brute == null ? ' (formula; too many to solve here)' : brute === f ? ` (solving the symmetry equations also gives ${brute})` : ` (solver gives ${brute}: check)`);
    grid.replaceChildren();
    if (r === 2 && kind !== 'riemann') {
      const svg = svgBox(grid, n * 26 + 2, n * 26 + 2, 'Component grid');
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        const free = kind === 'general' || (kind === 'symmetric' ? i <= j : i < j);
        const zero = kind === 'antisymmetric' && i === j;
        s('rect', { x: 1 + j * 26, y: 1 + i * 26, width: 24, height: 24, rx: 3, class: zero ? 'lw-c0' : free ? 'lw-c1' : 'lw-c2' }, svg);
      }
      h('p', { class: 'lw-note' }, grid, 'Bright: independent. Dim: fixed by its mirror across the diagonal. Empty: zero.');
    }
  };
  [sn, sr, sk].forEach(x => x.addEventListener('change', draw));
  draw();
  return {};
}

// ------------------------------------------------------------ Christoffel
function w_christoffelPolar(host, spec, ctx) {
  const W0 = 300, H0 = 220, S = 52, ox = 30, oy = H0 - 24;
  const svg = svgBox(host, W0, H0, 'Polar basis vectors and Christoffel symbols');
  const X = x => ox + x * S, Y = y => oy - y * S;
  const g = s('g', {}, svg);
  const mr = arrowHead(svg, 'lcr' + (++uid), ctx.color('r')), mt = arrowHead(svg, 'lct' + uid, ctx.color('theta'));
  const read = readout(host);
  const send = sceneSender(ctx, 'christoffel');
  const draw = r => {
    g.replaceChildren();
    for (const rr of [1, 2, 3, 4]) {
      const d = []; for (let k = 0; k <= 30; k++) { const a = k / 30 * Math.PI / 2; d.push(`${X(rr * Math.cos(a))},${Y(rr * Math.sin(a))}`); }
      s('polyline', { points: d.join(' '), class: 'lw-gridl' }, g);
    }
    for (let k = 0; k <= 6; k++) { const a = k / 6 * Math.PI / 2; s('line', { x1: X(0), y1: Y(0), x2: X(4.2 * Math.cos(a)), y2: Y(4.2 * Math.sin(a)), class: 'lw-gridl' }, g); }
    for (const th of [0.35, 0.75, 1.15]) {
      const px = r * Math.cos(th), py = r * Math.sin(th);
      const er = [Math.cos(th), Math.sin(th)], et = [-r * Math.sin(th), r * Math.cos(th)];
      const k = 0.45;
      s('line', { x1: X(px), y1: Y(py), x2: X(px + er[0] * k), y2: Y(py + er[1] * k), stroke: ctx.color('r'), 'stroke-width': 2, 'marker-end': mr }, g);
      s('line', { x1: X(px), y1: Y(py), x2: X(px + et[0] * k), y2: Y(py + et[1] * k), stroke: ctx.color('theta'), 'stroke-width': 2, 'marker-end': mt }, g);
    }
    const G = W.polarChristoffel(r);
    const N = W.christoffelNumeric(x => [[1, 0], [0, x[0] * x[0]]], [r, 0.7]);
    read([
      ['Γ<sup class="' + ctx.cls('theta') + '">θ</sup><sub><span class="' + ctx.cls('r') + '">r</span><span class="' + ctx.cls('theta') + '">θ</span></sub>', f2(G[1][0][1])],
      ['Γ<sup class="' + ctx.cls('r') + '">r</sup><sub><span class="' + ctx.cls('theta') + '">θθ</span></sub>', f2(G[0][1][1])],
      ['from the metric', `${f2(N[1][0][1])}, ${f2(N[0][1][1])}`, 'lw-inv'],
      ['|<i>e</i><sub>θ</sub>|', f2(r)],
    ]);
    send({ surface: 'polar', line: 'r' });
  };
  slider(host, { label: 'radius <i>r</i>', min: 0.4, max: 3.4, step: 0.01, value: spec.r || 1.5 }, draw);
  h('p', { class: 'lw-note' }, host, 'Three points on one circle. Moving round the circle, e_θ turns towards the centre (Γ^r_θθ = −r). Moving out, e_θ grows in proportion to r (Γ^θ_rθ = 1/r).');
  draw(spec.r || 1.5);
  return {};
}

// ------------------------------------------------------------ holonomy
function w_holonomy(host, spec, ctx) {
  const W0 = 300, H0 = 200, R = 72, cx = 90, cy = 104;
  const svg = svgBox(host, W0, H0, 'Holonomy round a circle of latitude');
  s('circle', { cx, cy, r: R, class: 'lw-sphere' }, svg);
  const cap = s('path', { class: 'lw-cap' }, svg);
  const lat = s('ellipse', { class: 'lw-lat' }, svg);
  const dial = s('g', { transform: 'translate(232 104)' }, svg);
  s('circle', { r: 44, class: 'lw-dial' }, dial);
  const mA = arrowHead(svg, 'lha' + (++uid), '#eceef2'), mB = arrowHead(svg, 'lhb' + uid, ctx.color('mu'));
  s('line', { x1: 0, y1: 0, x2: 0, y2: -40, stroke: '#eceef2', 'stroke-width': 2, 'marker-end': mA, 'stroke-opacity': 0.5 }, dial);
  const after = s('line', { x1: 0, y1: 0, stroke: ctx.color('mu'), 'stroke-width': 2.4, 'marker-end': mB }, dial);
  const arc = s('path', { class: 'lw-arc' }, dial);
  const read = readout(host);
  const send = sceneSender(ctx, 'parallel-transport');
  const draw = th => {
    const y = cy - R * Math.cos(th), rx = R * Math.sin(th), ry = rx * 0.28;
    lat.setAttribute('cx', cx); lat.setAttribute('cy', y); lat.setAttribute('rx', rx); lat.setAttribute('ry', ry);
    // cap: the part of the disc above the latitude line (side view)
    const large = th > Math.PI / 2 ? 1 : 0;
    cap.setAttribute('d', `M${cx - rx},${y} A${R},${R} 0 ${large} 1 ${cx + rx},${y} A${rx},${ry} 0 0 1 ${cx - rx},${y} Z`);
    const a = W.holonomyAngle(th), num = W.transportLatitude(th, 1500);
    const am = a % (2 * Math.PI);
    after.setAttribute('x2', 40 * Math.sin(am)); after.setAttribute('y2', -40 * Math.cos(am));
    const big = am > Math.PI ? 1 : 0;
    arc.setAttribute('d', am < 1e-3 ? '' : `M0,-26 A26,26 0 ${big} 1 ${26 * Math.sin(am)},${-26 * Math.cos(am)}`);
    read([
      ['colatitude θ', Math.round(th * DEG) + '°'],
      ['2π(1 − cos θ)', (a * DEG).toFixed(1) + '°'],
      ['by transport', (num * DEG).toFixed(1) + '°', 'lw-inv'],
      ['cap area / R²', (2 * Math.PI * (1 - Math.cos(th))).toFixed(3)],
    ]);
    send({ path: 'latitude', th0: Math.max(0.25, Math.min(1.45, th)) });
  };
  slider(host, { label: 'colatitude θ', min: 0.05, max: 3.09, step: 0.01, value: spec.colat || 1, fmt: x => Math.round(x * DEG) + '°' }, draw);
  h('p', { class: 'lw-note' }, host, 'The faint arrow is the start, the coloured arrow the same vector after one trip round the circle. The angle is shown modulo 360°.');
  draw(spec.colat || 1);
  return {};
}

// ------------------------------------------------------------ notation
export const NOTATION_FORMS = {
  component: { label: 'Component', tex: String.raw`u^{i} = \sum_{j=1}^{n} A^{i}{}_{j}\,v^{j}\quad(i = 1,\dots,n)`, say: 'Numbers in one basis. Ready to compute.' },
  abstract: { label: 'Abstract index', tex: String.raw`u^{a} = A^{a}{}_{b}\,v^{b}`, say: 'Letters name slots. True in every basis.' },
  free: { label: 'Index-free', tex: String.raw`u = A(v),\qquad A \in V\otimes V^{*}`, say: 'The map and its argument. Contractions are implicit.' },
  penrose: { label: 'Penrose', tex: String.raw`A^{a}{}_{b}\,v^{b}`, say: 'Nodes and legs. A joined leg is a sum.' },
};
function w_notation(host, spec, ctx) {
  const tabs = h('div', { class: 'lw-tabs', role: 'tablist' }, host);
  const body = h('div', { class: 'lw-nbody' }, host);
  const eq = h('div', { class: 'lw-eq sci-eq' }, body);
  const pic = h('div', { class: 'lw-pen' }, body);
  const say = h('p', { class: 'lw-note' }, body);
  const btns = {};
  const show = key => {
    const f = NOTATION_FORMS[key];
    for (const k in btns) btns[k].setAttribute('aria-selected', k === key ? 'true' : 'false');
    ctx.tex(eq, f.tex, true);
    say.textContent = f.say;
    pic.replaceChildren();
    if (key === 'penrose') penrosePic(pic, ctx);
    if (ctx.page && ctx.page.setView) ctx.page.setView(key === 'penrose' ? { views: ['tex', 'diagram'], style: 'penrose' } : 'all');
  };
  for (const k in NOTATION_FORMS) {
    btns[k] = h('button', { type: 'button', role: 'tab', class: 'lw-tab' }, tabs, NOTATION_FORMS[k].label);
    btns[k].addEventListener('click', () => show(k));
  }
  show(spec.form && NOTATION_FORMS[spec.form] ? spec.form : 'component');
  return {};
}
function penrosePic(host, ctx) {
  const svg = svgBox(host, 200, 150, 'Penrose diagram of A acting on v');
  const ca = ctx.color('a'), cb = ctx.color('b');
  s('line', { x1: 70, y1: 52, x2: 70, y2: 12, stroke: ca, 'stroke-width': 3 }, svg);
  s('path', { d: 'M70,88 C70,128 130,128 130,98', stroke: cb, 'stroke-width': 3, fill: 'none' }, svg);
  s('rect', { x: 46, y: 52, width: 48, height: 36, rx: 8, class: 'lw-node' }, svg);
  s('circle', { cx: 130, cy: 84, r: 15, class: 'lw-node' }, svg);
  const tA = s('text', { x: 70, y: 76, 'text-anchor': 'middle', class: 'lw-nodet' }, svg); tA.textContent = 'A';
  const tV = s('text', { x: 130, y: 89, 'text-anchor': 'middle', class: 'lw-nodet' }, svg); tV.textContent = 'v';
  const la = s('text', { x: 78, y: 22, fill: ca, class: 'lw-lab' }, svg); la.textContent = 'a';
  const lb = s('text', { x: 100, y: 134, fill: cb, class: 'lw-lab' }, svg); lb.textContent = 'b';
}

const TYPES = {
  'basis-drag': w_basisDrag, stretch: w_stretch, 'sum-expand': w_sumExpand, quiz: w_quiz,
  'raise-lower': w_raiseLower, 'outer-product': w_outerProduct, 'rotate-rank2': w_rotateRank2,
  count: w_count, 'christoffel-polar': w_christoffelPolar, holonomy: w_holonomy, notation: w_notation,
};
export const WIDGET_TYPES = Object.freeze(Object.keys(TYPES));

export function mountWidget(host, spec, ctx) {
  const fn = TYPES[spec.type];
  if (!fn) throw new Error('unknown widget ' + spec.type);
  const box = h('div', { class: 'lw lw-w-' + spec.type }, host);
  const r = fn(box, spec, ctx) || {};
  return { el: box, dispose() { box.remove(); if (r.dispose) r.dispose(); } };
}
