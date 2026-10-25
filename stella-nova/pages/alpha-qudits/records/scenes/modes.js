// ============================================================================
//  ALPHA QUDITS  ·  records/scenes/modes.js  ·  the drum analogy (analogy 4)
// ----------------------------------------------------------------------------
//  A square plate with the pattern u_mn = cos(m pi x) cos(n pi y), in the
//  look of pages/chladni-plate: sand gathers on the nodal lines. The mirror
//  is the diagonal x = y, which swaps m and n, as the swap of the reads
//  swaps the letter at read 1 with the letter at read 2. With n letters
//  there are n^2 patterns; n are their own mirror image and the rest pair
//  up. Each pair gives an even mode (symmetric across the diagonal) and an
//  odd one (a nodal line on the diagonal): n(n+1)/2 even and n(n-1)/2 odd.
//  The board shows all n^2 at once, even modes above the diagonal and on
//  it, odd modes below. The same arithmetic, read from MODEL, splits the
//  records of the solid edges q1q2 (n = 3) and Q1Q2 (n = 8).
//
//  The drums step (the look of pages/wave-membrane): two drums, read 1 and
//  read 2, carry one pattern each. Rung together they move in phase (even)
//  or against each other (odd), the two normal modes of a mirror-symmetric
//  pair. That is the split of the dashed edges, Q1q1 with Q2q2 and Q1q2
//  with q1Q2: each pattern of one edge pairs with its copy on the other.
//
//  grep -n targets:  const STEPS | function field | function sandStep |
//  function drawPlate | function drawBoard | function drawDrums | caption
// ============================================================================
import { SLOTS, edgeSplit, modeCounts, EDGES, wText } from '../data.js';
import { C, font, label, ease, clamp, lerp, rrect, SECTOR_COLOR } from '../draw.js';

const STEPS = [
  { id: 'plate3', label: 'Qubit edge', dur: 20 },
  { id: 'plate8', label: 'Qutrit edge', dur: 26 },
  { id: 'drums', label: 'Two drums', dur: 16 },
];
const PI = Math.PI;
const nQ = SLOTS.find(s => s.role === 'center').letters;   // letters at a copy
const nq = SLOTS.find(s => s.role === 'far').letters;      // letters at a qubit
const SOLID = { plate3: EDGES.find(e => e.solid && !e.arc && e.na === nq), plate8: EDGES.find(e => e.solid && !e.arc && e.na === nQ) };
const DASHED = EDGES.filter(e => !e.solid && !e.arc);

// The plate pattern of mode { i, j, sign } (letters i, j from 0), unnormalised.
function raw(m, x, y) {
  const a = (m.i + 1) * PI, b = (m.j + 1) * PI;
  const t1 = Math.cos(a * x) * Math.cos(b * y);
  if (m.sign === 0) return t1;
  return t1 + m.sign * Math.cos(b * x) * Math.cos(a * y);
}
const normCache = new Map();
function norm(m) {
  const k = m.i + ',' + m.j + ',' + m.sign;
  if (normCache.has(k)) return normCache.get(k);
  let mx = 0;
  for (let p = 0; p <= 40; p++) for (let q = 0; q <= 40; q++) mx = Math.max(mx, Math.abs(raw(m, p / 40, q / 40)));
  normCache.set(k, mx || 1);
  return mx || 1;
}
export function field(m, x, y) { return raw(m, x, y) / (m._n || (m._n = norm(m))); }

// The sequence of modes the big plate plays for n letters: raw placements
// first, then even / odd pairs and own images.
function sequence(n) {
  const seq = [];
  const pairs = [];
  for (let i = 0; i < n; i++) for (let j = i; j < n; j++) pairs.push([i, j]);
  // a spread of pairs, not only the first ones
  const pick = n <= 3 ? pairs : [[0, 1], [1, 1], [0, 2], [1, 3], [2, 2], [2, 5], [0, 4], [3, 6]].filter(p => p[1] < n);
  for (const [i, j] of pick) {
    if (i === j) seq.push({ i, j, sign: 0, kind: 'self' });
    else { seq.push({ i, j, sign: 1, kind: 'even' }); seq.push({ i, j, sign: -1, kind: 'odd' }); }
  }
  return seq;
}
const SEQ = { plate3: sequence(nq), plate8: sequence(nQ) };
const PHASE = { raw: 3.0, fold: 5.0 };   // seconds: raw placements, then the fold

function modeAt(st) {
  const n = st.step === 'plate3' ? nq : nQ, T = st.stepT, seq = SEQ[st.step];
  if (T < PHASE.raw) { const k = Math.floor(T / 0.6) % (n * n); return { i: Math.floor(k / n), j: k % n, sign: 0, kind: 'raw', idx: k }; }
  if (T < PHASE.fold) return { i: 0, j: 1, sign: 0, kind: 'raw', idx: 1 };
  const per = 2.4, k = Math.floor((T - PHASE.fold) / per) % seq.length;
  return { ...seq[k], idx: k, local: (T - PHASE.fold) - Math.floor((T - PHASE.fold) / per) * per };
}

// ---------------------------------------------------------------- sand
function sandInit(st, count) {
  let s = 12345;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  st.sand = new Float32Array(count * 2);
  for (let k = 0; k < count * 2; k++) st.sand[k] = rnd();
  st.rnd = rnd;
}
function sandStep(st, m, prev, w, dt) {
  const S = st.sand, rnd = st.rnd, n = S.length / 2;
  const kick = 0.022 * Math.sqrt(dt * 60);
  for (let k = 0; k < n; k++) {
    const x = S[2 * k], y = S[2 * k + 1];
    let f = field(m, x, y);
    if (prev && w < 1) f = lerp(field(prev, x, y), f, w);
    const a = Math.abs(f) * kick + 0.0006;
    let nx = x + (rnd() + rnd() - 1) * a, ny = y + (rnd() + rnd() - 1) * a;
    if (nx < 0) nx = -nx; if (nx > 1) nx = 2 - nx;
    if (ny < 0) ny = -ny; if (ny > 1) ny = 2 - ny;
    S[2 * k] = nx; S[2 * k + 1] = ny;
  }
}

// ---------------------------------------------------------------- images
const hasDom = () => typeof document !== 'undefined' && typeof document.createElement === 'function';
const tileCache = new Map();
function shadeInto(ctx, w, h, m, phase) {
  if (!ctx.createImageData) return;
  const img = ctx.createImageData(w, h), d = img.data;
  for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
    const f = field(m, (px + 0.5) / w, (py + 0.5) / h) * phase;
    const o = 4 * (py * w + px), a = Math.abs(f);
    const nodal = Math.exp(-a * a * 900);
    if (f > 0) { d[o] = 255; d[o + 1] = 154; d[o + 2] = 98; } else { d[o] = 98; d[o + 1] = 196; d[o + 2] = 255; }
    d[o + 3] = Math.round(255 * (0.08 + 0.42 * a));
    if (nodal > 0.2) { d[o] = 242; d[o + 1] = 227; d[o + 2] = 196; d[o + 3] = Math.round(255 * 0.7 * nodal); }
  }
  ctx.putImageData(img, 0, 0);
}
function tile(m, px) {
  const k = m.i + ',' + m.j + ',' + m.sign + '@' + px;
  if (tileCache.has(k)) return tileCache.get(k);
  if (!hasDom()) return null;
  const cv = document.createElement('canvas'); cv.width = px; cv.height = px;
  const ctx = cv.getContext('2d');
  if (!ctx) return null;
  shadeInto(ctx, px, px, m, 1);
  tileCache.set(k, cv);
  return cv;
}
let plateCv = null, plateCtx = null;
const PLATE_RES = 84;

// ---------------------------------------------------------------- layout
function geom(env, step) {
  const v = env.view, wide = v.w >= 560;
  if (wide) {
    const P = Math.min(v.w * 0.4, v.h - 120, 340);
    return { wide, P, px: v.x + v.w * 0.27 - P / 2, py: v.y + 30, B: P, bx: v.x + v.w * 0.73 - P / 2, by: v.y + 30, ty: v.y + 30 + P + 30 };
  }
  const P = Math.min(v.w - 60, (v.h - 140) * 0.52, 230), B = Math.min(v.w - 60, (v.h - 140) * 0.48, 220);
  return { wide, P, px: v.x + (v.w - P) / 2, py: v.y + 26, B, bx: v.x + (v.w - B) / 2, by: v.y + 26 + P + 26, ty: v.y + 26 + P + 26 + B + 24 };
}

function drawPlate(g, G, st, t, m, prev, w) {
  const { P, px, py } = G;
  // plate body
  g.save();
  rrect(g, px - 4, py - 4, P + 8, P + 8, 6);
  g.fillStyle = '#121a1f'; g.fill(); g.strokeStyle = 'rgba(200,220,230,0.22)'; g.lineWidth = 1; g.stroke();
  const phase = Math.cos(t * 7.5);
  if (hasDom()) {
    if (!plateCv) { plateCv = document.createElement('canvas'); plateCv.width = PLATE_RES; plateCv.height = PLATE_RES; plateCtx = plateCv.getContext('2d'); }
    if (plateCtx) {
      const mm = prev && w < 1 ? { blend: true } : null;
      if (mm) {
        // blend: shade the new mode, fade over the old
        shadeInto(plateCtx, PLATE_RES, PLATE_RES, prev, phase);
        g.globalAlpha = 1 - w; g.imageSmoothingEnabled = true; g.drawImage(plateCv, px, py, P, P);
        g.globalAlpha = w;
      }
      shadeInto(plateCtx, PLATE_RES, PLATE_RES, m, phase);
      g.imageSmoothingEnabled = true; g.drawImage(plateCv, px, py, P, P);
      g.globalAlpha = 1;
    }
  }
  // sand
  const S = st.sand;
  if (S) {
    g.fillStyle = C.sand; g.globalAlpha = 0.85;
    for (let k = 0; k < S.length; k += 2) g.fillRect(px + S[k] * P - 0.6, py + S[k + 1] * P - 0.6, 1.3, 1.3);
    g.globalAlpha = 1;
  }
  // the diagonal mirror
  g.strokeStyle = C.glass; g.globalAlpha = 0.65; g.setLineDash([4, 4]); g.lineWidth = 1.2;
  g.beginPath(); g.moveTo(px, py); g.lineTo(px + P, py + P); g.stroke();
  g.setLineDash([]);
  g.restore();
  label(g, 'mirror', px + P * 0.86, py + P * 0.8, { font: font(11), color: C.glass, halo: 'rgba(7,11,14,0.85)' });
}

function drawBoard(g, G, st, t, n, cur) {
  const { B, bx, by } = G, T = st.stepT;
  const ts = B / n, fold = ease(T, PHASE.raw, PHASE.fold);
  const px = Math.max(8, Math.round(ts * 0.86 * Math.min(2, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1)));
  const evenCol = SECTOR_COLOR['-+'], oddCol = SECTOR_COLOR['++'];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    // tile (row i, column j): above the diagonal (j > i) the even mode of
    // the pair, below (j < i) the odd one, on it the own image.
    const x = bx + j * ts, y = by + i * ts;
    const rawM = { i, j, sign: 0 };
    const comb = i === j ? rawM : j > i ? { i, j, sign: 1 } : { i: j, j: i, sign: -1 };
    const pad = Math.max(1, ts * 0.07);
    const appear = clamp((T * 3 - (i * n + j) * 0.04));
    if (appear <= 0) continue;
    g.save();
    g.globalAlpha = appear;
    const img0 = tile(rawM, px), img1 = tile(comb, px);
    if (img0 && fold < 1) { g.globalAlpha = appear * (1 - fold); g.drawImage(img0, x + pad, y + pad, ts - 2 * pad, ts - 2 * pad); }
    if (img1 && fold > 0) { g.globalAlpha = appear * fold; g.drawImage(img1, x + pad, y + pad, ts - 2 * pad, ts - 2 * pad); }
    if (!img0 && !img1) { g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(x + pad, y + pad, ts - 2 * pad, ts - 2 * pad); }
    g.globalAlpha = appear;
    const col = fold < 0.5 ? 'rgba(200,220,230,0.25)' : (j >= i ? evenCol : oddCol);
    const on = cur && ((cur.kind === 'raw' && cur.i === i && cur.j === j) ||
      (cur.kind === 'self' && cur.i === i && i === j) ||
      (cur.kind === 'even' && cur.i === i && cur.j === j) ||
      (cur.kind === 'odd' && cur.i === j && cur.j === i));
    g.strokeStyle = on ? C.text : col; g.lineWidth = on ? 2 : 1; g.globalAlpha = appear * (on ? 1 : 0.55 + 0.3 * fold);
    g.strokeRect(x + pad, y + pad, ts - 2 * pad, ts - 2 * pad);
    g.restore();
  }
  // the board's own diagonal: the same mirror
  g.save();
  g.strokeStyle = C.glass; g.globalAlpha = 0.6 * fold; g.setLineDash([4, 4]);
  g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + B, by + B); g.stroke();
  g.restore();
  if (fold > 0.5) {
    label(g, 'even', bx + B * 0.78, by - 9, { font: font(11, 600), color: evenCol, alpha: fold });
    label(g, 'odd', bx + B * 0.2, by + B + 10, { font: font(11, 600), color: oddCol, alpha: fold });
  }
}

// ---------------------------------------------------------------- drums
function drumZ(i, j, x, y) { return Math.sin((i + 1) * PI * x) * Math.sin((j + 1) * PI * y); }
function drawDrum(g, cx, cy, size, z, tint, labelTxt) {
  const K = 15, a = size * 0.5, b = size * 0.25, h = size * 0.22;
  const P = (x, y) => { const zz = z(x, y); return [cx + (x - y) * a, cy + (x + y - 1) * b - zz * h, zz]; };
  g.save();
  // rim
  g.strokeStyle = 'rgba(200,220,230,0.35)'; g.lineWidth = 1.4;
  g.beginPath(); const c0 = P(0, 0), c1 = P(1, 0), c2 = P(1, 1), c3 = P(0, 1);
  g.moveTo(c0[0], cy - b); g.lineTo(c1[0], cy); g.lineTo(c2[0], cy + b); g.lineTo(c3[0], cy); g.closePath(); g.stroke();
  g.lineWidth = 1;
  for (let dir = 0; dir < 2; dir++) for (let k = 1; k < K; k++) {
    const s = k / K;
    let last = null;
    for (let q = 0; q <= K * 2; q++) {
      const r = q / (K * 2);
      const p = dir ? P(s, r) : P(r, s);
      if (last) {
        const zm = (p[2] + last[2]) / 2;
        g.strokeStyle = zm >= 0 ? `rgba(255,154,98,${0.25 + 0.6 * Math.min(1, Math.abs(zm))})` : `rgba(98,196,255,${0.25 + 0.6 * Math.min(1, Math.abs(zm))})`;
        g.beginPath(); g.moveTo(last[0], last[1]); g.lineTo(p[0], p[1]); g.stroke();
      }
      last = p;
    }
  }
  g.restore();
  label(g, labelTxt, cx, cy + b + 16, { font: font(12), color: tint });
}
function drumPhase(T) {
  // t alone, Et alone, even, odd
  if (T < 3) return { k: 't', a1: 1, a2: 0 };
  if (T < 5.5) return { k: 'Et', a1: 0, a2: 1 };
  if (T < 10.5) return { k: 'even', a1: 1, a2: 1 };
  return { k: 'odd', a1: 1, a2: -1 };
}
const DRUM_PATTERNS = [[1, 0], [2, 1], [0, 2], [3, 1]];
function drawDrums(g, env, st, t) {
  const v = env.view, T = st.stepT, ph = drumPhase(T);
  const pat = DRUM_PATTERNS[(st.cycle || 0) % DRUM_PATTERNS.length];
  const [i, j] = [pat[0] % nQ, pat[1] % nq];
  const size = Math.min(v.w * 0.42, v.h * 0.6, 300);
  const cy = v.y + 34 + size * 0.5, x1 = v.x + v.w * 0.27, x2 = v.x + v.w * 0.73;
  const w = Math.cos(t * 6.0);
  const blend = ease(T % 1e9, 0, 0.4);
  drawDrum(g, x1, cy, size, (x, y) => ph.a1 * w * drumZ(i, j, x, y) * blend, C.text, 'read 1: Q1 with q1');
  drawDrum(g, x2, cy, size, (x, y) => ph.a2 * w * drumZ(i, j, x, y) * blend, C.text, 'read 2: Q2 with q2');
  // mirror between the drums
  g.save();
  g.strokeStyle = C.glass; g.globalAlpha = 0.6; g.setLineDash([4, 4]);
  g.beginPath(); g.moveTo(v.x + v.w / 2, cy - size * 0.4); g.lineTo(v.x + v.w / 2, cy + size * 0.4); g.stroke();
  g.restore();
  const head = { t: 't: the pattern on drum 1', Et: 'Et: its mirror copy on drum 2', even: 't + Et: in phase (even)', odd: 't − Et: against each other (odd)' }[ph.k];
  label(g, head, v.x + v.w / 2, v.y + 14, { font: font(13, 600), color: ph.k === 'even' ? SECTOR_COLOR['+-'] : ph.k === 'odd' ? SECTOR_COLOR['++'] : C.text });
  // tally from the model
  const sp = edgeSplit(DASHED.map(e => e.id));
  const per = DASHED[0].products;
  const yT = cy + size * 0.25 + 44;
  const nar = v.w < 560;
  label(g, nar ? `${DASHED[0].na} · ${DASHED[0].nb} = ${per} patterns per drum: ${per} even + ${per} odd` : `${DASHED[0].na} · ${DASHED[0].nb} = ${per} patterns per drum, each with its copy: ${per} even + ${per} odd`, v.x + v.w / 2, yT, { font: font(nar ? 11 : 13), color: C.text });
  label(g, nar ? `Dashed edges: ${sp.even} even at ${wText(2)}, ${sp.odd} odd at 1` : `Dashed edges in the model: ${sp.even} even at ${wText(2)}, ${sp.odd} odd at 1 (${sp.records} records)`, v.x + v.w / 2, yT + 20, { font: font(nar ? 11 : 13), color: C.rec });
  // two traces: the height of a point of each drum over the last 2.5 s
  const sy = yT + 44, sh = Math.min(90, v.y + v.h - sy - 10);
  if (sh < 40) return;
  const sx = v.x + 16, sw = v.w - 32;
  g.save();
  g.strokeStyle = 'rgba(200,220,230,0.12)'; g.lineWidth = 1;
  for (const yy of [sy + sh * 0.27, sy + sh * 0.73]) { g.beginPath(); g.moveTo(sx, yy); g.lineTo(sx + sw, yy); g.stroke(); }
  for (const [n, yy, col] of [[1, sy + sh * 0.27, C.qutrit], [2, sy + sh * 0.73, C.qubit]]) {
    g.strokeStyle = col; g.lineWidth = 1.6; g.beginPath();
    for (let q = 0; q <= 120; q++) {
      const back = 2.5 * (1 - q / 120), Tq = T - back;
      const pq = Tq < 0 ? { a1: 0, a2: 0 } : drumPhase(Tq);
      const z = (n === 1 ? pq.a1 : pq.a2) * Math.cos((t - back) * 6.0);
      const x = sx + sw * q / 120, y = yy - z * sh * 0.2;
      if (q) g.lineTo(x, y); else g.moveTo(x, y);
    }
    g.stroke();
    label(g, 'drum ' + n, sx + 2, yy - sh * 0.2 - 2, { font: font(11), color: col, align: 'left' });
  }
  g.restore();
}

// ---------------------------------------------------------------- scene
function draw(g, env, st, t) {
  if (st.step === 'drums') { drawDrums(g, env, st, t); st.lastT = t; return; }
  const n = st.step === 'plate3' ? nq : nQ;
  const G = geom(env, st.step);
  const m = modeAt(st);
  const key = m.i + ',' + m.j + ',' + m.sign;
  if (!st.sand || st.sandStep !== st.step) {
    sandInit(st, env.W < 500 ? 900 : 1500); st.sandStep = st.step; st.modeKey = null;
  }
  if (st.modeKey !== key) { st.prevMode = st.curMode || null; st.curMode = m; st.modeKey = key; st.modeT = t; }
  const w = clamp((t - (st.modeT ?? t)) / 0.5);
  const dt = clamp(t - (st.lastT ?? t), 0, 0.05);
  st.lastT = t;
  if (dt > 0) sandStep(st, m, st.prevMode, w, dt);
  drawPlate(g, G, st, t, m, st.prevMode, w);
  drawBoard(g, G, st, t, n, m);
  // plate heading
  const head = m.kind === 'raw' ? `pattern (${m.i + 1}, ${m.j + 1}): one letter pair, before the mirror`
    : m.kind === 'self' ? `pattern (${m.i + 1}, ${m.i + 1}) is its own mirror image: even`
      : m.kind === 'even' ? `(${m.i + 1}, ${m.j + 1}) + (${m.j + 1}, ${m.i + 1}): even, symmetric across the mirror`
        : `(${m.i + 1}, ${m.j + 1}) − (${m.j + 1}, ${m.i + 1}): odd, a nodal line on the mirror`;
  label(g, head, G.px + G.P / 2, G.py - 12, { font: font(env.view.w < 420 ? 11 : 12, 600), color: m.kind === 'odd' ? SECTOR_COLOR['++'] : m.kind === 'raw' ? C.text : SECTOR_COLOR['-+'] });
  // tally
  const mc = modeCounts(n), e = SOLID[st.step], sp = edgeSplit(e.id);
  const fs = env.view.w < 420 ? 11 : 13;
  const cx = env.view.x + env.view.w / 2;
  const fold = ease(st.stepT, PHASE.raw, PHASE.fold);
  label(g, `${n} letters: ${mc.placements} patterns = ${mc.self} own images + ${(mc.placements - mc.self) / 2} pairs`, cx, G.ty, { font: font(fs), color: C.text });
  label(g, `→ ${mc.even} even + ${mc.odd} odd`, cx, G.ty + fs + 6, { font: font(fs, 600), color: C.text, alpha: fold });
  label(g, `Edge ${e.id} in the model: ${sp.records - sp.odd} survive X at ${wText(3)}, ${sp.odd} at 1`, cx, G.ty + 2 * (fs + 6), { font: font(fs), color: C.rec, alpha: fold });
}

export default {
  id: 'modes',
  title: 'Mirrors and drum modes',
  steps: STEPS,
  analogy: {
    right: 'A plate with a mirror symmetry has two kinds of modes: even ones that the mirror leaves alone and odd ones with a nodal line on the mirror. A pattern and its mirror image always combine into one of each, so n patterns give n(n+1)/2 even and n(n−1)/2 odd modes, which is exactly how the records of a solid edge split.',
    breaks: 'Plate and drum modes are waves with frequencies; records are operators with none, and the wave numbers here are only labels for the letters. On a plate both parities ring; which parity "survives" is the paper’s definition of the known, and the weights √2 and √3 come from where each exchange acts, which no drum supplies.',
  },
  height(W) { return W >= 560 ? Math.round(clamp(W * 0.6, 420, 500)) : Math.round(clamp(W * 1.62, 500, 620)); },
  init() { return {}; },
  draw,
  caption(st) {
    if (st.step === 'drums') {
      const sp = edgeSplit(DASHED.map(e => e.id));
      return `Two drums for the two reads. One pattern rung on both drums moves in phase (even) or against itself (odd). The ${sp.records} records of the dashed edges split the same way: ${sp.even} even ones survive Y (k = 2), ${sp.odd} odd ones do not.`;
    }
    const n = st.step === 'plate3' ? nq : nQ, mc = modeCounts(n), e = SOLID[st.step];
    return `Plate with the diagonal as mirror, ${n} letters (edge ${e.id}): ${mc.placements} patterns give ${mc.even} even modes and ${mc.odd} odd ones. The even ones are the records that survive X.`;
  },
};
