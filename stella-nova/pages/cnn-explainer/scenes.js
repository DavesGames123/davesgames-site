// ============================================================================
//  CNN EXPLAINER  ·  scenes.js  the animated detail views
// ----------------------------------------------------------------------------
//  makeScene(ctx) builds the detail scene of one feature map (or of the
//  output) for a layer type. ctx = { result, W (weights), maps, li, c,
//  ci (the input channel the conv scene shows first) }.
//
//    input    the picture, one pixel at a time: R, G and B / 255
//    conv     the kernel slides over the input maps: window x kernel =
//             products, their sum per channel, the sum of all channels,
//             plus the bias; the output map fills in as it goes
//    relu     each value through max(0, x), on the graph of ReLU
//    pool     the 2 x 2 window and its largest value
//    dense    flatten, the dot product with the weights of one class, and
//             the softmax (the output layer)
//
//  A scene with positions (count > 0) is driven by a float t: position
//  floor(t), and the window glides to the next one in the fraction. The
//  dense scene has count 0 and loops t over 0..1 phases.
//
//  scene.draw(g, w, h, t) draws in CSS px and returns hit boxes:
//  [{ kind: 'out' | 'chan' | 'class', x, y, w, h, ... }].
//  scene.say(p) is one plain line for the aria-live readout.
//
//  grep -n 'export function makeScene'
//  grep -n 'function convScene'   grep -n 'function reluScene'
//  grep -n 'function poolScene'   grep -n 'function inputScene'
//  grep -n 'function denseScene'  grep -n 'function grid3'
// ============================================================================
import { ARCH, CLASSES, convTerms, poolWindow } from './net.js';
import { THEME as T, roundRect } from './draw.js';
import { signedFill } from './colour.js';

const MINUS = '−';
export const fmt = (v, d = 2) => (v < 0 ? MINUS : '') + Math.abs(v).toFixed(Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : d);
const ease = k => k * k * (3 - 2 * k);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function label(g, text, x, y, { size = 12, color = T.dim, align = 'left', weight = 400, font = T.sans } = {}) {
  g.font = `${weight} ${size}px ${font}`; g.fillStyle = color; g.textAlign = align; g.textBaseline = 'alphabetic';
  g.fillText(text, x, y);
}

function mapBox(g, im, x, y, s, alpha = 1) {
  g.save(); g.imageSmoothingEnabled = false; g.globalAlpha = alpha;
  if (im && im.width) g.drawImage(im, x, y, s, s); else { g.fillStyle = T.track; g.fillRect(x, y, s, s); }
  g.restore();
  g.strokeStyle = T.line; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1);
}

// the output map as far as the scan has come (row major), the rest faint
function revealMap(g, im, x, y, s, n, p) {
  mapBox(g, im, x, y, s, 0.14);
  const py = Math.floor(p / n), px = p % n, k = s / n;
  g.save(); g.beginPath();
  if (py > 0) g.rect(x, y, s, py * k);
  g.rect(x, y + py * k, (px + 1) * k, k);
  g.clip(); mapBox(g, im, x, y, s, 1); g.restore();
}

function ring(g, x, y, w, h, color = T.field, lw = 1.5) {
  g.strokeStyle = color; g.lineWidth = lw; g.strokeRect(x, y, w, h);
}

// A 3 x 3 (or 2 x 2) grid of numbers. fill(v, i) -> css colour or null.
function grid3(g, vals, n, x, y, cs, { fill = null, hi = -1, title = '', fs = null } = {}) {
  const f = fs || clamp(cs * 0.3, 9.5, 13);
  if (title) label(g, title, x + n * cs / 2, y - 7, { size: 11.5, align: 'center' });
  for (let i = 0; i < n * n; i++) {
    const cx = x + (i % n) * cs, cy = y + Math.floor(i / n) * cs;
    const col = fill ? fill(vals[i], i) : null;
    if (col) { g.fillStyle = col; g.fillRect(cx + 1, cy + 1, cs - 2, cs - 2); }
    g.strokeStyle = i === hi ? T.accent : T.line; g.lineWidth = i === hi ? 2 : 1;
    g.strokeRect(cx + 0.5, cy + 0.5, cs - 1, cs - 1);
    if (cs >= 22) label(g, fmt(vals[i]), cx + cs / 2, cy + cs / 2 + f * 0.36, { size: f, color: T.ink, align: 'center', font: T.mono });
  }
}

function op(g, s, x, y, size = 16) { label(g, s, x, y, { size, color: T.dim, align: 'center' }); }

// zones: landscape = three columns, portrait = rows
function zones(w, h) {
  const pad = 14;
  if (w >= h * 1.15) {
    const aw = w * 0.31, bw = w * 0.4, cw = w - aw - bw;
    return { land: true, pad, A: { x: pad, y: pad, w: aw - pad, h: h - 2 * pad }, B: { x: aw + 6, y: pad, w: bw - 12, h: h - 2 * pad }, C: { x: aw + bw, y: pad, w: cw - pad, h: h - 2 * pad } };
  }
  const top = h * 0.42;
  return { land: false, pad, A: { x: pad, y: pad, w: w / 2 - pad * 1.5, h: top }, C: { x: w / 2 + pad / 2, y: pad, w: w / 2 - pad * 1.5, h: top }, B: { x: pad, y: pad + top + 8, w: w - 2 * pad, h: h - top - 2 * pad - 8 } };
}

export function makeScene(ctx) {
  const t = ARCH[ctx.li].type;
  if (t === 'input') return inputScene(ctx);
  if (t === 'conv') return convScene(ctx);
  if (t === 'relu') return reluScene(ctx);
  if (t === 'pool') return poolScene(ctx);
  return denseScene(ctx);
}

// the window cell of position t on an n-wide output, with a glide
function glide(t, n, count) {
  const p = clamp(Math.floor(t), 0, count - 1), f = ease(clamp(t - p, 0, 1));
  const y = Math.floor(p / n), x = p % n;
  const q = Math.min(count - 1, p + 1), y2 = Math.floor(q / n), x2 = q % n;
  if (y2 !== y || f === 0) return { p, y, x, fy: y, fx: x };
  return { p, y, x, fy: y, fx: x + (x2 - x) * f };
}

// ── conv ───────────────────────────────────────────────────────────────────
function convScene(ctx) {
  const { result, W, maps, li, c } = ctx;
  const L = result.layers[li], P = result.layers[li - 1], n = L.W, count = L.H * L.W;
  const st = { ci: ctx.ci || 0, auto: ctx.ci == null };
  const kmax = Math.max(...Array.from(W[ARCH[li].w].kernel, Math.abs));
  return {
    kind: 'conv', count, n, st, c,
    title: `${ARCH[li].label} · map ${c + 1}`,
    sub: `3 × 3 kernels over ${P.C} input ${P.C === 3 ? 'channels' : 'maps'}, stride 1, no padding`,
    say(p) {
      const y = Math.floor(p / n), x = p % n, tm = convTerms(W, result.layers, li, y, x, c);
      return `Position row ${y + 1}, column ${x + 1}: sum of ${P.C} channels ${fmt(tm.sum)}, plus bias ${fmt(tm.bias)}, gives ${fmt(tm.out)}.`;
    },
    draw(g, w, h, tt) {
      const Z = zones(w, h), hits = [];
      const gl = glide(tt, n, count), tm = convTerms(W, result.layers, li, gl.y, gl.x, c);
      // auto: a new input channel at each position, unless the scan is fast
      if (st.auto && !st.hold) st.ci = gl.p % P.C;
      const ci = clamp(st.ci, 0, P.C - 1), ch = tm.chans[ci];
      // A: the input map of channel ci, the window, and all channels below
      const A = Z.A, stripH = Z.land ? Math.min(70, A.h * 0.22) : Math.min(40, A.h * 0.2);
      const sA = Math.floor(Math.min(A.w, A.h - stripH - 34));
      const ax = A.x + (A.w - sA) / 2, ay = A.y + 18;
      label(g, P.C === 3 ? `Input · ${['red', 'green', 'blue'][ci]} channel` : `${ARCH[li - 1].label} · map ${ci + 1}`, A.x + A.w / 2, A.y + 10, { align: 'center' });
      const pim = maps.img(li - 1, ci); mapBox(g, pim, ax, ay, sA);
      const k = sA / P.W;
      ring(g, ax + gl.fx * k, ay + gl.fy * k, 3 * k, 3 * k);
      // channel strip
      const nn = P.C, per = Z.land ? Math.min(nn, 5) : nn, rows = Math.ceil(nn / per);
      const cs = Math.floor(Math.min((A.w - (per - 1) * 4) / per, (stripH - (rows - 1) * 4) / rows));
      const sx = A.x + (A.w - (per * cs + (per - 1) * 4)) / 2, sy = ay + sA + 12;
      for (let i = 0; i < nn; i++) {
        const x = sx + (i % per) * (cs + 4), y = sy + Math.floor(i / per) * (cs + 4);
        mapBox(g, maps.img(li - 1, i), x, y, cs, i === ci ? 1 : 0.55);
        const kk = cs / P.W; ring(g, x + gl.fx * kk, y + gl.fy * kk, Math.max(2, 3 * kk), Math.max(2, 3 * kk), T.field, 1);
        if (i === ci) ring(g, x - 2, y - 2, cs + 4, cs + 4, T.accent, 1.5);
        hits.push({ kind: 'chan', ci: i, x, y, w: cs, h: cs });
      }
      // B: window x kernel = products, then the sums
      const B = Z.B, gcs = Math.floor(clamp(Math.min((B.w - 60) / 9, (B.h - 120) / 3.4), 14, 44));
      const gw = 3 * gcs, gx0 = B.x + (B.w - (3 * gw + 60)) / 2, gy0 = B.y + 30;
      const vmax = Math.max(1e-6, ...ch.win.map(Math.abs)), pmax = Math.max(1e-6, ...ch.prod.map(Math.abs));
      grid3(g, ch.win, 3, gx0, gy0, gcs, { title: 'Input window', fill: v => signedFill(v, vmax, 0.4) });
      op(g, '×', gx0 + gw + 15, gy0 + gw / 2 + 6);
      grid3(g, ch.ker, 3, gx0 + gw + 30, gy0, gcs, { title: 'Kernel', fill: v => signedFill(v, kmax, 0.6) });
      op(g, '=', gx0 + 2 * gw + 45, gy0 + gw / 2 + 6);
      grid3(g, ch.prod, 3, gx0 + 2 * gw + 60, gy0, gcs, { title: 'Products', fill: v => signedFill(v, pmax, 0.55) });
      let y = gy0 + gw + 26;
      label(g, `Sum of the 9 products = ${fmt(ch.sum, 3)}`, B.x + B.w / 2, y, { size: 13, color: T.ink, align: 'center' });
      // the sum over all channels as chips
      y += 22;
      const cper = Math.min(nn, 5), chipW = Math.min(64, (B.w - (cper - 1) * 6) / cper), chipH = 22;
      const cx0 = B.x + (B.w - (cper * (chipW + 6) - 6)) / 2;
      const smax = Math.max(1e-6, ...tm.chans.map(q => Math.abs(q.sum)));
      tm.chans.forEach((q, i) => {
        const x = cx0 + (i % cper) * (chipW + 6), yy = y + Math.floor(i / cper) * (chipH + 6);
        g.fillStyle = signedFill(q.sum, smax, 0.45); roundRect(g, x, yy, chipW, chipH, 5); g.fill();
        if (i === ci) { g.strokeStyle = T.accent; g.lineWidth = 1.5; roundRect(g, x, yy, chipW, chipH, 5); g.stroke(); }
        label(g, fmt(q.sum), x + chipW / 2, yy + 15, { size: 11, color: T.ink, align: 'center', font: T.mono });
        hits.push({ kind: 'chan', ci: i, x, y: yy, w: chipW, h: chipH });
      });
      y += Math.ceil(nn / cper) * (chipH + 6) + 16;
      label(g, `${fmt(tm.sum, 3)} + bias ${fmt(tm.bias, 3)} = ${fmt(tm.out, 3)}`, B.x + B.w / 2, y, { size: 15, color: T.ink, align: 'center', font: T.mono });
      label(g, `the sum of the ${nn} ${nn === 3 ? 'channels' : 'maps'}`, B.x + B.w / 2, y + 18, { size: 11.5, align: 'center' });
      // C: the output map fills in
      const C = Z.C, sC = Math.floor(Math.min(C.w, C.h - 70)), cx = C.x + (C.w - sC) / 2, cy = C.y + 18;
      label(g, `${ARCH[li].label} · map ${c + 1}`, C.x + C.w / 2, C.y + 10, { align: 'center' });
      revealMap(g, maps.img(li, c), cx, cy, sC, n, gl.p);
      const kc = sC / n; ring(g, cx + gl.x * kc - 1, cy + gl.y * kc - 1, kc + 2, kc + 2, T.accent, 1.5);
      label(g, `= ${fmt(tm.out, 3)}`, C.x + C.w / 2, cy + sC + 22, { size: 14, color: T.ink, align: 'center', font: T.mono });
      label(g, `after ReLU: ${fmt(Math.max(0, tm.out), 3)}`, C.x + C.w / 2, cy + sC + 40, { size: 11.5, align: 'center' });
      hits.push({ kind: 'out', x: cx, y: cy, w: sC, h: sC, n });
      return hits;
    },
  };
}

// ── relu ───────────────────────────────────────────────────────────────────
function reluScene(ctx) {
  const { result, maps, li, c } = ctx;
  const L = result.layers[li], P = result.layers[li - 1], n = L.W, count = L.H * L.W;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < n * n; i++) { const v = P.data[i * P.C + c]; if (v < lo) lo = v; if (v > hi) hi = v; }
  const span = Math.max(Math.abs(lo), Math.abs(hi), 1e-3);
  return {
    kind: 'relu', count, n, c,
    title: `${ARCH[li].label} · map ${c + 1}`,
    sub: 'max(0, x) on every value',
    say(p) { const v = P.data[p * P.C + c]; return `Value ${fmt(v, 3)} becomes ${fmt(Math.max(0, v), 3)}.`; },
    draw(g, w, h, tt) {
      const Z = zones(w, h), hits = [], gl = glide(tt, n, count);
      const v = P.data[gl.p * P.C + c], r = Math.max(0, v);
      const A = Z.A, sA = Math.floor(Math.min(A.w, A.h - 40)), ax = A.x + (A.w - sA) / 2, ay = A.y + 18;
      label(g, `${ARCH[li - 1].label} · map ${c + 1}`, A.x + A.w / 2, A.y + 10, { align: 'center' });
      mapBox(g, maps.img(li - 1, c), ax, ay, sA);
      const k = sA / n; ring(g, ax + gl.fx * k - 1, ay + gl.fy * k - 1, k + 2, k + 2);
      // B: the ReLU graph
      const B = Z.B, gs = Math.min(B.w * 0.8, B.h - 70), gx = B.x + (B.w - gs) / 2, gy = B.y + 14;
      const X = x => gx + (x + span) / (2 * span) * gs, Y = y => gy + gs - (y + span) / (2 * span) * gs;
      g.strokeStyle = T.line; g.lineWidth = 1;
      g.beginPath(); g.moveTo(gx, Y(0)); g.lineTo(gx + gs, Y(0)); g.moveTo(X(0), gy); g.lineTo(X(0), gy + gs); g.stroke();
      g.strokeStyle = T.pos; g.lineWidth = 2.5; g.beginPath(); g.moveTo(X(-span), Y(0)); g.lineTo(X(0), Y(0)); g.lineTo(X(span), Y(span)); g.stroke();
      g.strokeStyle = 'rgba(255,214,102,0.5)'; g.lineWidth = 1; g.setLineDash([3, 3]);
      g.beginPath(); g.moveTo(X(v), Y(0)); g.lineTo(X(v), Y(r)); g.lineTo(X(0), Y(r)); g.stroke(); g.setLineDash([]);
      g.fillStyle = T.field; g.beginPath(); g.arc(X(v), Y(r), 5, 0, Math.PI * 2); g.fill();
      label(g, 'x', gx + gs - 4, Y(0) - 6, { align: 'right', size: 12 });
      label(g, `max(0, ${fmt(v, 3)}) = ${fmt(r, 3)}`, B.x + B.w / 2, gy + gs + 34, { size: 15, color: T.ink, align: 'center', font: T.mono });
      label(g, v < 0 ? 'negative: set to zero' : 'positive: passes as it is', B.x + B.w / 2, gy + gs + 54, { size: 11.5, align: 'center' });
      const C = Z.C, sC = Math.floor(Math.min(C.w, C.h - 40)), cx = C.x + (C.w - sC) / 2, cy = C.y + 18;
      label(g, `${ARCH[li].label} · map ${c + 1}`, C.x + C.w / 2, C.y + 10, { align: 'center' });
      revealMap(g, maps.img(li, c), cx, cy, sC, n, gl.p);
      const kc = sC / n; ring(g, cx + gl.x * kc - 1, cy + gl.y * kc - 1, kc + 2, kc + 2, T.accent);
      hits.push({ kind: 'out', x: cx, y: cy, w: sC, h: sC, n }, { kind: 'out', x: ax, y: ay, w: sA, h: sA, n });
      return hits;
    },
  };
}

// ── pool ───────────────────────────────────────────────────────────────────
function poolScene(ctx) {
  const { result, maps, li, c } = ctx;
  const L = result.layers[li], P = result.layers[li - 1], n = L.W, count = L.H * L.W;
  return {
    kind: 'pool', count, n, c,
    title: `${ARCH[li].label} · map ${c + 1}`,
    sub: '2 × 2 window, stride 2: keep the largest value',
    say(p) { const y = Math.floor(p / n), x = p % n, pw = poolWindow(result.layers, li, y, x, c); return `Window ${pw.vals.map(v => fmt(v)).join(', ')}: the largest is ${fmt(pw.max)}.`; },
    draw(g, w, h, tt) {
      const Z = zones(w, h), hits = [], gl = glide(tt, n, count);
      const pw = poolWindow(result.layers, li, gl.y, gl.x, c);
      const A = Z.A, sA = Math.floor(Math.min(A.w, A.h - 40)), ax = A.x + (A.w - sA) / 2, ay = A.y + 18;
      label(g, `${ARCH[li - 1].label} · map ${c + 1}`, A.x + A.w / 2, A.y + 10, { align: 'center' });
      mapBox(g, maps.img(li - 1, c), ax, ay, sA);
      const k = sA / P.W; ring(g, ax + gl.fx * 2 * k, ay + gl.fy * 2 * k, 2 * k, 2 * k);
      const B = Z.B, cs = Math.floor(clamp(Math.min(B.w / 4, (B.h - 90) / 2.4), 22, 64)), gx = B.x + (B.w - 2 * cs) / 2, gy = B.y + 34;
      const m = Math.max(1e-6, ...pw.vals.map(Math.abs));
      grid3(g, pw.vals, 2, gx, gy, cs, { title: 'The 2 × 2 window', hi: pw.arg, fill: v => signedFill(v, m, 0.4), fs: clamp(cs * 0.26, 11, 15) });
      label(g, `max = ${fmt(pw.max, 3)}`, B.x + B.w / 2, gy + 2 * cs + 34, { size: 15, color: T.ink, align: 'center', font: T.mono });
      label(g, 'Four values become one: the map halves in each direction.', B.x + B.w / 2, gy + 2 * cs + 56, { size: 11.5, align: 'center' });
      const C = Z.C, sC = Math.floor(Math.min(C.w, C.h - 40)), cx = C.x + (C.w - sC) / 2, cy = C.y + 18;
      label(g, `${ARCH[li].label} · map ${c + 1}`, C.x + C.w / 2, C.y + 10, { align: 'center' });
      revealMap(g, maps.img(li, c), cx, cy, sC, n, gl.p);
      const kc = sC / n; ring(g, cx + gl.x * kc - 1, cy + gl.y * kc - 1, kc + 2, kc + 2, T.accent);
      hits.push({ kind: 'out', x: cx, y: cy, w: sC, h: sC, n });
      return hits;
    },
  };
}

// ── input ──────────────────────────────────────────────────────────────────
function inputScene(ctx) {
  const { result, maps } = ctx;
  const L = result.layers[0], n = 64, count = n * n;
  return {
    kind: 'input', count, n,
    title: 'Input · 64 × 64 × 3',
    sub: 'each pixel is three numbers: red, green and blue, divided by 255',
    say(p) { const v = [0, 1, 2].map(k => L.data[p * 3 + k]); return `Pixel row ${Math.floor(p / n) + 1}, column ${p % n + 1}: red ${fmt(v[0], 3)}, green ${fmt(v[1], 3)}, blue ${fmt(v[2], 3)}.`; },
    draw(g, w, h, tt) {
      const hits = [], gl = glide(tt, n, count), land = w >= h * 1.15, pad = 14;
      const s = Math.floor(land ? Math.min(w * 0.36, h - 50) : Math.min(w - 2 * pad, h * 0.4));
      const ax = land ? pad + (w * 0.4 - s) / 2 : (w - s) / 2, ay = 26;
      label(g, 'The picture', ax + s / 2, 16, { align: 'center' });
      mapBox(g, maps.img(0, -1), ax, ay, s);
      const k = s / n; ring(g, ax + gl.fx * k - 1, ay + gl.fy * k - 1, k + 2, k + 2);
      hits.push({ kind: 'out', x: ax, y: ay, w: s, h: s, n });
      const bx = land ? w * 0.42 : pad, bw = land ? w * 0.58 - pad : w - 2 * pad, by = land ? 26 : ay + s + 30;
      const cs = Math.floor(Math.min((bw - 24) / 3, land ? h * 0.42 : (h - by - 70)));
      const names = ['red', 'green', 'blue'];
      for (let ch = 0; ch < 3; ch++) {
        const x = bx + ch * (cs + 12), raw = L.data[gl.p * 3 + ch];
        label(g, names[ch], x + cs / 2, by - 10, { align: 'center' });
        mapBox(g, maps.img(0, ch), x, by, cs);
        const kk = cs / n; ring(g, x + gl.fx * kk - 1, by + gl.fy * kk - 1, kk + 2, kk + 2);
        label(g, `${Math.round(raw * 255)} / 255`, x + cs / 2, by + cs + 20, { size: 12.5, color: T.ink, align: 'center', font: T.mono });
        label(g, `= ${raw.toFixed(3)}`, x + cs / 2, by + cs + 38, { size: 12.5, color: T.ink, align: 'center', font: T.mono });
      }
      return hits;
    },
  };
}

// ── dense + softmax ─────────────────────────────────────────────────────────
function denseScene(ctx) {
  const { result, W, maps } = ctx;
  const P = result.layers[10], flat = P.data, z = result.logits, probs = result.probs;
  const st = { k: ctx.c == null ? result.top : ctx.c };
  const wk = W.output.kernel, m = z.length;
  const zmax = Math.max(...z.map(Math.abs), 1e-6);
  const ez = z.map(v => Math.exp(v - Math.max(...z)));
  const esum = ez.reduce((a, b) => a + b, 0);
  return {
    kind: 'dense', count: 0, st,
    title: 'Output · flatten, dense and softmax',
    sub: '1690 numbers in, one score per class, then probabilities',
    say() { const k = st.k; return `${CLASSES[k]}: score ${fmt(z[k], 3)}, probability ${(probs[k] * 100).toFixed(1)} percent.`; },
    draw(g, w, h, tt) {
      const hits = [], k = st.k, ph = tt % 1, pad = 14, land = w >= h * 1.15;
      const a1 = ease(clamp(ph / 0.22, 0, 1)), a2 = ease(clamp((ph - 0.22) / 0.26, 0, 1)), a3 = ease(clamp((ph - 0.5) / 0.2, 0, 1)), a4 = ease(clamp((ph - 0.72) / 0.2, 0, 1));
      // left: the ten pooled maps, the flat strip, the class weights
      const L = land ? { x: pad, y: pad, w: w * 0.52 - pad, h: h - 2 * pad } : { x: pad, y: pad, w: w - 2 * pad, h: h * 0.46 };
      const per = 5, ms = Math.floor(Math.min((L.w - 4 * 8) / per, (L.h * 0.42 - 26) / 2));
      const mx0 = L.x + (L.w - (per * ms + 32)) / 2;
      label(g, `${ARCH[10].label} · 10 maps of 13 × 13`, L.x + L.w / 2, L.y + 10, { align: 'center' });
      for (let c = 0; c < 10; c++) mapBox(g, maps.img(10, c), mx0 + (c % per) * (ms + 8), L.y + 18 + Math.floor(c / per) * (ms + 8), ms, 1 - 0.5 * a1);
      const sy = L.y + 18 + 2 * (ms + 8) + 16, sw = L.w, cell = sw / flat.length;
      label(g, 'Flatten: 13 × 13 × 10 = 1690 numbers', L.x + L.w / 2, sy, { size: 11.5, align: 'center' });
      let fmax = 1e-6; for (const v of flat) if (v > fmax) fmax = v;
      const n1 = Math.round(flat.length * a1);
      for (let i = 0; i < n1; i++) { g.fillStyle = maps.rgb(flat[i] / fmax); g.fillRect(L.x + i * cell, sy + 6, Math.max(1, cell + 0.4), 14); }
      const wy = sy + 44;
      label(g, `Weights of “${CLASSES[k]}” (blue +, orange −)`, L.x + L.w / 2, wy, { size: 11.5, align: 'center', color: a2 > 0 ? T.dim : T.faint });
      let wmax = 1e-6; for (let i = 0; i < flat.length; i++) wmax = Math.max(wmax, Math.abs(wk[i * m + k]));
      const n2 = Math.round(flat.length * a2);
      for (let i = 0; i < n2; i++) { g.fillStyle = signedFill(wk[i * m + k], wmax, 1); g.fillRect(L.x + i * cell, wy + 6, Math.max(1, cell + 0.4), 14); }
      let run = W.output.bias[k]; for (let i = 0; i < n2; i++) run += flat[i] * wk[i * m + k];
      label(g, `score = Σ value × weight + bias = ${fmt(a2 >= 1 ? z[k] : run, 3)}`, L.x + L.w / 2, wy + 44, { size: 13.5, color: T.ink, align: 'center', font: T.mono });
      // right: scores, then probabilities
      const R = land ? { x: w * 0.55, y: pad, w: w * 0.45 - pad, h: h - 2 * pad } : { x: pad, y: h * 0.5, w: w - 2 * pad, h: h * 0.5 - pad };
      const rowH = Math.min(30, (R.h - 26) / m), nameW = Math.min(92, R.w * 0.3), bw = R.w - nameW - 60;
      label(g, a4 > 0.5 ? 'Probability (softmax)' : 'Score of each class', R.x + R.w / 2, R.y + 10, { align: 'center' });
      for (let i = 0; i < m; i++) {
        const y = R.y + 22 + i * rowH, on = i === k;
        const show = clamp(a3 * m - i, 0, 1);
        label(g, CLASSES[i], R.x + nameW - 6, y + rowH * 0.62, { size: 12, align: 'right', color: on ? T.ink : T.dim, weight: on ? 600 : 400 });
        hits.push({ kind: 'class', k: i, x: R.x, y, w: R.w, h: rowH });
        const bx = R.x + nameW, by = y + rowH * 0.22, bh = rowH * 0.56;
        g.fillStyle = T.track; g.fillRect(bx, by, bw, bh);
        // score bar from the centre, morphing to a probability bar from the left
        const zc = bx + bw / 2, zl = z[i] / zmax * bw / 2 * show;
        const pw = probs[i] * bw;
        const x0 = zc + (bx - zc) * a4, x1 = (zc + zl) + ((bx + pw) - (zc + zl)) * a4;
        g.fillStyle = on ? T.accent : a4 > 0.5 ? T.bar : (z[i] >= 0 ? 'rgba(98,196,255,0.55)' : 'rgba(255,154,98,0.55)');
        g.fillRect(Math.min(x0, x1), by, Math.abs(x1 - x0), bh);
        const txt = a4 > 0.5 ? (probs[i] * 100).toFixed(probs[i] >= 0.1 ? 1 : 2) + '%' : fmt(z[i]);
        if (show > 0) label(g, txt, bx + bw + 54, y + rowH * 0.62, { size: 11.5, align: 'right', color: on ? T.accent : T.faint, font: T.mono });
      }
      const fy = R.y + 22 + m * rowH + 18;
      if (fy < h - 4 && a4 > 0) label(g, `e^${fmt(z[k])} / Σ e^z = ${(ez[k] / esum).toFixed(4)}`, R.x + R.w / 2, fy, { size: 12.5, color: T.ink, align: 'center', font: T.mono });
      return hits;
    },
  };
}
