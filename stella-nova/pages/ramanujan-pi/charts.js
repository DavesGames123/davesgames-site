// ============================================================================
//  RAMANUJAN PI  ·  charts.js — the canvas 2D views  (no DOM access)
// ----------------------------------------------------------------------------
//  Each draw function takes a 2D context whose transform maps CSS px, a
//  rect r = { x, y, w, h } in CSS px, the data from worker.js and options.
//  It draws vectors and text only, so a caller can scale the context (the
//  screensaver push-in) and stay sharp. Each one returns a small layout
//  object, which main.js uses for hover and tap hit tests.
//
//  Colours: INK for text, the math classes of lib/sci.css for the parts of
//  the formula (m1 s(k), m2 A k + B, m3 C^k, m4 sign, m5 prefactor), and
//  SERIES_COLOR for the series lines (a categorical set checked for colour
//  blindness on this dark ground; each line also has a direct label).
//
//  grep -n targets
//    "export function drawRace"      correct digits against terms
//    "export function drawStream"    the digits of pi, locked term by term
//    "export function drawAnatomy"   the factors of one term on a log axis
//    "export function drawCompute"   digit counts and the digit walk
// ============================================================================

export const INK = { hi: '#eef0f4', ink: '#d6d9e0', dim: '#8d93a0', faint: '#3a3f4a', grid: 'rgba(200,210,230,0.08)', bg: '#0a0c11' };
export const M = { m1: '#62c4ff', m2: '#ff9a62', m3: '#86dc7c', m4: '#e889dc', m5: '#ffd666', m6: '#a8a4ff' };
// Series order: the eight Ramanujan-Sato series take the eight categorical
// slots in order; Machin and Leibniz are grey with a dash.
export const SERIES_COLOR = {
  l1a: { c: '#3987e5' }, l2a: { c: '#d95926' }, l3a: { c: '#199e70' }, l4a: { c: '#c98500' },
  l5a: { c: '#d55181' }, l6a: { c: '#008300' }, l7a: { c: '#9085e9' }, l10a: { c: '#e66767' },
  machin: { c: '#b4b9c4', dash: [6, 4] }, leibniz: { c: '#7d838f', dash: [2, 4] },
};
const SANS = 'Inter, system-ui, -apple-system, sans-serif';
const SERIF = "'STIX Two Text', 'Times New Roman', Georgia, serif";
const MONO = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace";
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const fmtInt = n => Math.round(n).toLocaleString('en-US');

// A power of ten with a real raised exponent: pre + '10' + exp. A minus
// sign in exp is the true minus (U+2212); the superscript minus glyph
// was missing in some fonts. after: plain text after the power.
export function drawPow(g, pre, exp, x, y, px, family, color, align = 'left', base = 'alphabetic', after = '') {
  const e = String(exp).replace('-', '−'), big = `${px}px ${family}`, small = `${Math.round(px * 0.72 * 10) / 10}px ${family}`;
  g.font = big; const w1 = g.measureText(pre + '10').width, w3 = after ? g.measureText(after).width : 0;
  g.font = small; const w2 = g.measureText(e).width;
  const W = w1 + w2 + w3, x0 = align === 'right' ? x - W : align === 'center' ? x - W / 2 : x;
  g.fillStyle = color; g.textAlign = 'left'; g.textBaseline = base;
  g.font = big; g.fillText(pre + '10', x0, y);
  g.font = small; g.fillText(e, x0 + w1 + 0.5, y - px * 0.42);
  if (after) { g.font = big; g.fillText(after, x0 + w1 + w2 + 1, y); }
  return W;
}
function text(g, s, x, y, font, color, align = 'left', base = 'alphabetic') {
  g.font = font; g.fillStyle = color; g.textAlign = align; g.textBaseline = base; g.fillText(s, x, y);
}

// ---------------------------------------------------------------------------
// RACE. x: terms summed (linear), y: correct digits (log scale). race is
// the worker reply: [{ id, digits: [d after 1 term, 2 terms, ...], cap }].
// o: { T, sel, reveal (terms drawn, may be fractional), names, compact }
export function drawRace(g, r, race, o) {
  const compact = o.compact || r.w < 560;
  const nameOf = id => (compact && o.short && o.short[id]) || (o.names && o.names[id]) || id;
  g.font = `600 ${compact ? 10.5 : 12}px ${SANS}`;
  const labW = Math.max(...race.map(s => g.measureText(nameOf(s.id) + (o.heads ? `  ${fmtInt(Math.max(...s.digits))}` : '')).width)) + 34;
  const L = r.x + (compact ? 40 : 54), R = r.x + r.w - labW, Tp = r.y + 28, B = r.y + r.h - 34;
  let maxD = 10;
  for (const s of race) for (const d of s.digits) maxD = Math.max(maxD, d);
  const top = Math.ceil(Math.log10(maxD) + 0.05), T = o.T;
  const X = k => L + (R - L) * (k / T), Y = d => B - (B - Tp) * (Math.log10(Math.max(1, d)) / top);
  // grid and axes
  g.lineWidth = 1;
  for (let e = 0; e <= top; e++) {
    for (let m = 1; m < 10; m++) {
      const v = m * 10 ** e; if (Math.log10(v) > top + 1e-9) break;
      const y = Math.round(Y(v)) + 0.5;
      g.strokeStyle = m === 1 ? 'rgba(200,210,230,0.16)' : INK.grid;
      g.beginPath(); g.moveTo(L, y); g.lineTo(R, y); g.stroke();
      if (m === 1) text(g, fmtInt(v), L - 8, y, `${compact ? 10 : 11}px ${MONO}`, INK.dim, 'right', 'middle');
    }
  }
  const step = niceStep(T, compact ? 4 : 7);
  for (let k = 0; k <= T + 1e-9; k += step) {
    const x = Math.round(X(k)) + 0.5;
    g.strokeStyle = INK.grid; g.beginPath(); g.moveTo(x, Tp); g.lineTo(x, B); g.stroke();
    text(g, String(k), x, B + 16, `${compact ? 10 : 11}px ${MONO}`, INK.dim, 'center');
  }
  g.strokeStyle = 'rgba(200,210,230,0.3)'; g.beginPath(); g.moveTo(L + 0.5, Tp); g.lineTo(L + 0.5, B + 0.5); g.lineTo(R, B + 0.5); g.stroke();
  text(g, 'Correct digits (log scale)', L, Tp - 12, `500 ${compact ? 11 : 12}px ${SANS}`, INK.ink);
  text(g, 'Terms summed', R, B + 30, `${compact ? 10.5 : 11.5}px ${SANS}`, INK.dim, 'right');

  // lines: the selected one last and thicker
  const order = race.slice().sort((a, b) => (a.id === o.sel) - (b.id === o.sel));
  const ends = [];
  g.save(); g.beginPath(); g.rect(L, Tp - 4, R - L + 4, B - Tp + 8); g.clip();
  for (const s of order) {
    const col = SERIES_COLOR[s.id], on = s.id === o.sel, n = Math.min(s.digits.length, Math.floor(o.reveal));
    if (n < 1) continue;
    g.strokeStyle = col.c; g.lineWidth = on ? 3 : 2; g.globalAlpha = o.sel && !on ? 0.75 : 1;
    g.setLineDash(col.dash || []); g.lineJoin = 'round'; g.lineCap = 'round';
    g.beginPath();
    g.moveTo(X(0), Y(0));
    for (let i = 0; i < n; i++) g.lineTo(X(i + 1), Y(s.digits[i]));
    // the partial segment to the reveal point
    const f = o.reveal - Math.floor(o.reveal);
    if (f > 0 && n < s.digits.length) g.lineTo(X(n + f), Y(s.digits[n - 1] + (s.digits[n] - s.digits[n - 1]) * f));
    g.stroke(); g.setLineDash([]); g.globalAlpha = 1;
    const last = n < s.digits.length ? n : s.digits.length, d = s.digits[last - 1];
    const hx = f > 0 && n < s.digits.length ? n + f : last, hd = f > 0 && n < s.digits.length ? s.digits[n - 1] + (s.digits[n] - s.digits[n - 1]) * f : d;
    ends.push({ id: s.id, x: X(hx), y: Y(hd), d, n: last, on, capped: last === s.digits.length && d >= s.cap && last < T });
  }
  g.restore();
  if (o.heads) for (const e of ends) if (!e.capped) {
    g.fillStyle = SERIES_COLOR[e.id].c; g.beginPath(); g.arc(e.x, e.y, e.on ? 4.5 : 3, 0, 7); g.fill();
  }
  // markers where a series hit the digit cap of this chart
  for (const e of ends) if (e.capped) {
    g.fillStyle = SERIES_COLOR[e.id].c; g.beginPath(); g.arc(e.x, e.y, 3.5, 0, 7); g.fill();
  }
  // direct labels at the right edge, pushed apart
  const lab = ends.map(e => ({ ...e, ly: e.y })).sort((a, b) => a.ly - b.ly), gap = compact ? 13 : 15;
  for (let i = 1; i < lab.length; i++) if (lab[i].ly - lab[i - 1].ly < gap) lab[i].ly = lab[i - 1].ly + gap;
  for (let i = lab.length - 1; i >= 0; i--) {
    const lim = i === lab.length - 1 ? B + 4 : lab[i + 1].ly - gap;
    if (lab[i].ly > lim) lab[i].ly = lim;
  }
  for (const e of lab) {
    const col = SERIES_COLOR[e.id], lx = R + 10;
    g.strokeStyle = col.c; g.lineWidth = 2; g.setLineDash(col.dash || []);
    g.beginPath(); g.moveTo(lx, e.ly); g.lineTo(lx + 12, e.ly); g.stroke(); g.setLineDash([]);
    const name = nameOf(e.id) + (o.heads ? `  ${fmtInt(e.d)}` : '');
    text(g, name, lx + 17, e.ly, `${e.on ? 600 : 400} ${compact ? 10.5 : 12}px ${SANS}`, e.on ? INK.hi : INK.ink, 'left', 'middle');
  }
  return { L, R, Tp, B, X, Y, T, kAt: x => clamp(Math.round((x - L) / (R - L) * T), 1, T) };
}
function niceStep(T, n) {
  const raw = T / n, p = 10 ** Math.floor(Math.log10(raw)), m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}

// ---------------------------------------------------------------------------
// STREAM. The decimals of pi in blocks of ten. A decimal that term t fixed
// (st.lock) shows in the tone of t once k >= t: odd terms blue, even terms
// gold, so each term's block of digits shows. The decimals not yet fixed
// show the digits of the current approximation, dim. o: { k, flash 0..1 }
export function drawStream(g, r, st, o) {
  const D = st.D, k = o.k;
  // the largest font that fits all D decimals (blocks of ten, gap between)
  let fs = 26, cw, lh, per, rows, lead;
  for (; fs > 7; fs -= 0.5) {
    cw = fs * 0.62; lh = fs * 1.5; lead = cw * 2.4;
    const blockW = cw * 10 + cw * 0.9, blocks = Math.max(1, Math.floor((r.w - lead) / blockW));
    per = blocks * 10; rows = Math.ceil(D / per);
    if (rows * lh <= r.h) break;
  }
  const blockW = cw * 10 + cw * 0.9, gw = (per / 10) * blockW - cw * 0.9 + lead;
  const x0 = r.x + Math.max(0, (r.w - gw) / 2), y0 = r.y + Math.max(0, (r.h - rows * lh) / 2) + fs;
  const font = `${fs}px ${MONO}`;
  g.font = font; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  g.fillStyle = INK.hi; g.fillText('3.', x0, y0);
  const approx = k >= 1 ? st.strs[Math.min(k, st.K) - 1] : null;
  const pos = p => { const row = Math.floor(p / per), c = p % per; return [x0 + lead + Math.floor(c / 10) * blockW + (c % 10) * cw, y0 + row * lh]; };
  let lockedNow = 0, firstOpen = -1;
  for (let p = 0; p < D; p++) {
    const t = st.lock[p], [x, y] = pos(p);
    if (t && t <= k) {
      lockedNow++;
      if (t === k && o.flash > 0) {
        g.fillStyle = `rgba(255,255,255,${0.12 * o.flash})`; g.fillRect(x - 1, y - fs * 0.92, cw + 1, fs * 1.18);
        g.fillStyle = INK.hi;
      } else g.fillStyle = t % 2 ? M.m1 : M.m5;
      g.fillText(st.ref[p + 1], x, y);
    } else {
      if (firstOpen < 0) firstOpen = p;
      g.fillStyle = INK.faint;
      g.fillText(approx ? approx[p + 1] : '·', x, y);
    }
  }
  // a caret under the first decimal not fixed yet
  if (firstOpen >= 0 && k >= 1) {
    const [x, y] = pos(firstOpen);
    g.fillStyle = M.m2; g.fillRect(x, y + fs * 0.22, cw * 0.9, Math.max(1.5, fs * 0.08));
  }
  return { locked: lockedNow, hit: (mx, my) => {
    const row = Math.floor((my - y0 + fs) / lh), cx = mx - x0 - lead;
    if (row < 0 || row >= rows || cx < 0) return -1;
    const b = Math.floor(cx / blockW), c = Math.floor((cx - b * blockW) / cw);
    if (c > 9) return -1;
    const p = row * per + b * 10 + c;
    return p < D ? p : -1;
  }, cell: p => { const [x, y] = pos(p); return { x, y: y - fs, w: cw, h: fs * 1.3 }; } };
}

// ---------------------------------------------------------------------------
// ANATOMY. Top: the factors of term k on one log10 axis, as a walk from 1:
// up by s(k), up by A k + B, down by C^k, then the prefactor; the dot at
// the end is the size of the term. Bottom: the size of every term against
// k, with the line of slope -rate. rows: worker anatomy rows. o: { k, S,
// rate, compact, kMax }
export function drawAnatomy(g, r, rows, o) {
  const compact = o.compact || r.w < 560, k = clamp(Math.round(o.k), 0, rows.length - 1), a = rows[k];
  const fsz = compact ? 11 : 12.5;
  const walkOnly = r.h < 340, splitY = walkOnly ? r.y + r.h : r.y + r.h * (compact ? 0.52 : 0.5);
  // --- the walk ---
  const lab = compact ? 62 : 92, L = r.x + lab, R = r.x + r.w - (compact ? 12 : 20);
  const steps = [
    { name: 's(k)', cls: M.m1, from: 0, to: a.ls, v: a.sHead + (a.sLen > 18 ? `  (${a.sLen} digits)` : '') },
    { name: 'Ak + B', cls: M.m2, from: a.ls, to: a.ls + a.ll, v: a.lin },
    { name: 'Cᵏ', cls: M.m3, from: a.ls + a.ll, to: a.ls + a.ll - a.lc, v: k === 0 ? '1' : `${a.cLen} digits` },
    { name: 'prefactor', cls: M.m5, from: a.ls + a.ll - a.lc, to: a.lt, v: '' },
  ];
  let lo, hi;
  if (o.range) [lo, hi] = o.range;
  else {
    lo = Math.min(0, a.lt, a.ls + a.ll - a.lc); hi = Math.max(1, a.ls + a.ll);
    lo = Math.floor(lo - (hi - lo) * 0.04 - 0.5); hi = Math.ceil(hi + (hi - lo) * 0.04 + 0.5);
  }
  const X = v => L + (R - L) * (v - lo) / (hi - lo);
  const t0 = r.y + (walkOnly ? 14 : compact ? 34 : 44), rowH = Math.min(compact ? 36 : 46, (splitY - t0 - (walkOnly ? 26 : 40)) / 5);
  if (!walkOnly) text(g, `Term k = ${k}, on a log scale`, r.x + 2, r.y + (compact ? 12 : 16), `500 ${fsz + 0.5}px ${SANS}`, INK.ink, 'left', 'middle');
  // decade ticks
  const st = niceStep(hi - lo, compact ? 4 : 8), axY = t0 + rowH * 5 + 6;
  g.lineWidth = 1;
  for (let v = Math.ceil(lo / st) * st; v <= hi; v += st) {
    const x = Math.round(X(v)) + 0.5;
    g.strokeStyle = v === 0 ? 'rgba(200,210,230,0.35)' : INK.grid;
    g.beginPath(); g.moveTo(x, t0 - 6); g.lineTo(x, axY); g.stroke();
    drawPow(g, '', v, x, axY + 16, fsz - 1, SERIF, INK.dim, 'center');
  }
  steps.forEach((s, i) => {
    const y = t0 + rowH * (i + 0.5), x1 = X(s.from), x2 = X(s.to), hgt = Math.max(6, rowH * 0.42);
    text(g, s.name, r.x + lab - 10, y, `italic ${fsz + 1}px ${SERIF}`, s.cls, 'right', 'middle');
    g.fillStyle = s.cls; g.globalAlpha = 0.9;
    const xa = Math.min(x1, x2), w = Math.max(1.5, Math.abs(x2 - x1));
    roundRect(g, xa, y - hgt / 2, w, hgt, Math.min(3, w / 2)); g.fill(); g.globalAlpha = 1;
    // the direction of the step
    const dir = x2 >= x1 ? 1 : -1, ax = x2, ah = Math.min(7, w);
    g.beginPath(); g.moveTo(ax + dir * 1, y); g.lineTo(ax - dir * ah, y - hgt / 2 - 3); g.lineTo(ax - dir * ah, y + hgt / 2 + 3); g.closePath(); g.fill();
    // the dotted link to the next row
    if (i < steps.length - 1) { g.strokeStyle = INK.faint; g.setLineDash([2, 3]); g.beginPath(); g.moveTo(x2, y); g.lineTo(x2, y + rowH); g.stroke(); g.setLineDash([]); }
    const pre = `${s.to - s.from >= 0 ? '×' : '÷'} `, ex = Math.abs(s.to - s.from).toFixed(1), after = s.v && !compact && !walkOnly ? `   ${s.v}` : '';
    // the value above the bar, from its start point in its direction
    const vy = y - hgt / 2 - 5, up = x2 >= x1, px = fsz + 1;
    g.font = `${px}px ${SERIF}`;
    const tw = g.measureText(pre + '10' + ex + after).width, ok = up ? x1 + tw < R + 8 : x1 - tw > L - lab + 8;
    drawPow(g, pre, ex, ok ? x1 : up ? x1 - 4 : x1 + 4, vy, px, SERIF, INK.dim, (up === ok) ? 'left' : 'right', 'bottom', after);
  });
  // the result
  const yR = t0 + rowH * 4.5, xR = X(a.lt);
  text(g, 'term', r.x + lab - 10, yR, `italic ${fsz + 1}px ${SERIF}`, INK.hi, 'right', 'middle');
  g.fillStyle = INK.hi; g.beginPath(); g.arc(xR, yR, 5, 0, 7); g.fill();
  const right = xR > (L + R) / 2;
  drawPow(g, a.neg ? '−' : '+', a.lt.toFixed(1), xR + (right ? -12 : 12), yR, fsz + 2, SERIF, INK.hi, right ? 'right' : 'left', 'middle');

  if (walkOnly) return { kAt: null, P: { T: Infinity } };
  // --- the sizes of all terms ---
  const P = { L: r.x + (compact ? 44 : 56), R: r.x + r.w - (compact ? 12 : 20), T: splitY + 34, B: r.y + r.h - 30 };
  const K = rows.length - 1, minT = Math.min(...rows.map(q => q.lt)), maxT = Math.max(...rows.map(q => q.lt));
  const yLo = Math.floor(minT - 1), yHi = Math.ceil(maxT + 0.5);
  const SX = j => P.L + (P.R - P.L) * j / Math.max(1, K), SY = v => P.T + (P.B - P.T) * (yHi - v) / Math.max(1e-9, yHi - yLo);
  text(g, 'Size of each term, log₁₀ |term|', P.L, P.T - 14, `500 ${fsz + 0.5}px ${SANS}`, INK.ink);
  const ys = niceStep(yHi - yLo, 4);
  for (let v = Math.ceil(yLo / ys) * ys; v <= yHi; v += ys) {
    const y = Math.round(SY(v)) + 0.5;
    g.strokeStyle = INK.grid; g.beginPath(); g.moveTo(P.L, y); g.lineTo(P.R, y); g.stroke();
    text(g, String(v), P.L - 8, y, `${fsz - 1.5}px ${MONO}`, INK.dim, 'right', 'middle');
  }
  const xs = niceStep(K, compact ? 4 : 8);
  for (let j = 0; j <= K; j += xs) text(g, String(j), SX(j), P.B + 15, `${fsz - 1.5}px ${MONO}`, INK.dim, 'center');
  text(g, 'k', P.R, P.B + 28, `italic ${fsz}px ${SERIF}`, INK.dim, 'right');
  g.strokeStyle = 'rgba(200,210,230,0.3)'; g.beginPath(); g.moveTo(P.L + 0.5, P.T); g.lineTo(P.L + 0.5, P.B + 0.5); g.lineTo(P.R, P.B + 0.5); g.stroke();
  // the rate line through term 0
  g.strokeStyle = M.m6; g.setLineDash([5, 5]); g.lineWidth = 1.2;
  g.beginPath(); g.moveTo(SX(0), SY(rows[0].lt)); g.lineTo(SX(K), SY(rows[0].lt - o.rate * K)); g.stroke(); g.setLineDash([]);
  const rl = `slope −${o.rate.toFixed(2)}: ${o.rate.toFixed(2)} digits per term`;
  text(g, rl, P.R, P.T + 4, `${fsz - 0.5}px ${SANS}`, M.m6, 'right', 'top');
  for (let j = 0; j <= K; j++) {
    const q = rows[j], x = SX(j), y = SY(q.lt), on = j === k, rad = on ? 5 : K > 80 ? 2 : 3;
    g.beginPath(); g.arc(x, y, rad, 0, 7);
    if (q.neg) { g.strokeStyle = on ? INK.hi : INK.dim; g.lineWidth = 1.4; g.stroke(); }
    else { g.fillStyle = on ? INK.hi : INK.dim; g.fill(); }
    if (on) { g.strokeStyle = INK.hi; g.lineWidth = 1; g.beginPath(); g.arc(x, y, 9, 0, 7); g.stroke(); }
  }
  return { SX, SY, P, K, kAt: mx => clamp(Math.round((mx - P.L) / (P.R - P.L) * K), 0, K) };
}
function roundRect(g, x, y, w, h, rr) {
  g.beginPath(); g.moveTo(x + rr, y); g.lineTo(x + w - rr, y); g.quadraticCurveTo(x + w, y, x + w, y + rr);
  g.lineTo(x + w, y + h - rr); g.quadraticCurveTo(x + w, y + h, x + w - rr, y + h); g.lineTo(x + rr, y + h);
  g.quadraticCurveTo(x, y + h, x, y + h - rr); g.lineTo(x, y + rr); g.quadraticCurveTo(x, y, x + rr, y); g.closePath();
}

// ---------------------------------------------------------------------------
// COMPUTE. Left (or top): how often each digit 0..9 occurs in the decimals,
// with the expected count n/10 and a band of two standard deviations.
// Right (or bottom): the digit walk, one unit step per decimal in the
// direction 36° x digit. res: the worker compute reply. o: { compact, walkN }
export function drawCompute(g, r, res, o) {
  const compact = o.compact || r.w < 620, fsz = compact ? 11 : 12;
  if (!res) {
    text(g, 'Pick a digit count and press Compute.', r.x + r.w / 2, r.y + r.h / 2, `${fsz + 2}px ${SANS}`, INK.dim, 'center', 'middle');
    return {};
  }
  const n = res.digits.length - 1;
  const a = compact ? { x: r.x, y: r.y, w: r.w, h: r.h * 0.42 } : { x: r.x, y: r.y, w: r.w * 0.42, h: r.h };
  const b = compact ? { x: r.x, y: r.y + r.h * 0.46, w: r.w, h: r.h * 0.54 } : { x: r.x + r.w * 0.47, y: r.y, w: r.w * 0.53, h: r.h };
  // counts
  const E = n / 10, sd = Math.sqrt(n * 0.1 * 0.9), mx = Math.max(...res.counts, E + 2 * sd) * 1.06;
  const P = { L: a.x + 50, R: a.x + a.w - 8, T: a.y + 36, B: a.y + a.h - 26 };
  let chi = 0; for (const c of res.counts) chi += (c - E) ** 2 / E;
  text(g, `How often each digit occurs in ${fmtInt(n)} decimals`, P.L - 42, a.y + 12, `500 ${fsz + 0.5}px ${SANS}`, INK.ink, 'left', 'middle');
  const Y = v => P.B - (P.B - P.T) * v / mx;
  g.fillStyle = 'rgba(168,164,255,0.10)'; g.fillRect(P.L, Y(E + 2 * sd), P.R - P.L, Y(E - 2 * sd) - Y(E + 2 * sd));
  const bw = (P.R - P.L) / 10;
  for (let d = 0; d < 10; d++) {
    const x = P.L + d * bw + bw * 0.18, w = bw * 0.64, y = Y(res.counts[d]);
    g.fillStyle = M.m1; roundRect(g, x, y, w, P.B - y, Math.min(3, w / 2)); g.fill();
    g.fillRect(x, P.B - 3, w, 3);
    text(g, String(d), x + w / 2, P.B + 15, `${fsz}px ${MONO}`, INK.ink, 'center');
  }
  g.strokeStyle = M.m6; g.lineWidth = 1.2; g.setLineDash([5, 4]); g.beginPath(); g.moveTo(P.L, Y(E)); g.lineTo(P.R, Y(E)); g.stroke(); g.setLineDash([]);
  for (const v of [0, Math.round(E)]) text(g, fmtInt(v), P.L - 6, Y(v), `${fsz - 1.5}px ${MONO}`, INK.dim, 'right', 'middle');
  text(g, `expected n/10, band ±2σ · χ² = ${chi.toFixed(2)} on 9 degrees of freedom`, P.L, P.T - 12, `${fsz - 1}px ${SANS}`, M.m6, 'left', 'middle');
  // walk
  const N = Math.min(n, o.walkN || n), ang = [];
  for (let d = 0; d < 10; d++) ang.push([Math.cos(d * Math.PI / 5), -Math.sin(d * Math.PI / 5)]);
  let x = 0, y = 0, x0 = 0, x1 = 0, y0 = 0, y1 = 0;
  for (let i = 1; i <= N; i++) { const s = ang[res.digits.charCodeAt(i) - 48]; x += s[0]; y += s[1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const top = b.y + 30, sc = Math.min((b.w - 20) / Math.max(1, x1 - x0), (b.h - 50) / Math.max(1, y1 - y0));
  const ox = b.x + b.w / 2 - sc * (x0 + x1) / 2, oy = top + (b.h - 40) / 2 - sc * (y0 + y1) / 2;
  text(g, `Digit walk: one step per decimal, direction 36° × digit`, b.x + 4, b.y + 12, `500 ${fsz + 0.5}px ${SANS}`, INK.ink, 'left', 'middle');
  const segs = 24, per = Math.ceil(N / segs);
  x = 0; y = 0; g.lineWidth = N > 200000 ? 0.5 : N > 20000 ? 0.7 : 1; g.lineJoin = 'round';
  for (let sgi = 0; sgi < segs; sgi++) {
    const f = sgi / (segs - 1);
    g.strokeStyle = `rgb(${Math.round(40 + 158 * f)},${Math.round(90 + 130 * f)},${Math.round(160 + 95 * f)})`;
    g.beginPath(); g.moveTo(ox + sc * x, oy + sc * y);
    const end = Math.min(N, (sgi + 1) * per);
    for (let i = sgi * per + 1; i <= end; i++) { const s = ang[res.digits.charCodeAt(i) - 48]; x += s[0]; y += s[1]; g.lineTo(ox + sc * x, oy + sc * y); }
    g.stroke();
  }
  g.fillStyle = M.m5; g.beginPath(); g.arc(ox, oy, 3.5, 0, 7); g.fill();
  g.fillStyle = M.m2; g.beginPath(); g.arc(ox + sc * x, oy + sc * y, 3.5, 0, 7); g.fill();
  text(g, 'start', ox + 7, oy - 7, `${fsz - 1}px ${SANS}`, M.m5);
  return { chi };
}
