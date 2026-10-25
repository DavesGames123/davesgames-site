// ============================================================================
//  STRANDS · scenes.js — the five thread scenes, drawn at time t
// ----------------------------------------------------------------------------
//  DOM-free. drawScene(g, name, params, t, rect, env) draws one frame of a
//  scene into rect on the 2D context g and returns { step, stepCount }.
//  The frame is a pure function of (params, t, live), so a scrubbed t, the
//  page clock and the saver all give the same picture.
//
//    pair    d1, d2 in 1..4. d threads of amplitude 1/√d; unequal ends share
//            min(d1, d2) threads. Two bars: the amplitudes sum to √m, the
//            Born weights to 1. A pluck (live.plucks) shakes the rope.
//    swap    d in 2..4. Eq. (S1) on a 13 s loop: two pairs, the tie on 2-3,
//            the routes re-tie into a 1-4 pair, the result.
//    read    link 'qutrit-qubit' | 'qubit-qutrit' | 'qubit-qubit', basis k.
//            Each basis element of the read end goes down the threads; the
//            far end gets ⟨e|ω⟩ (quantum.js farStates), drawn as clock
//            hands. A row below lists every far state of the basis.
//    shared  k in 1..4 links at one qutrit. One qudit -> one copy per link
//            -> exchange of two links (twice, which is no exchange).
//    object  stage 'auto' | 'knot' | 'strands' | 'paths' | 'terms' |
//            'weights'. Theorem 1's object, its strand picture, the routes
//            q1 -> q2, the 12 terms of Eq. (S2), the two mirrors.
//
//  env: { th (paint.js THEMES entry), live: { plucks: [{ t0, amp }] },
//         facts: model-link.js facts(), focus: optional term index }
//
//  EXPORTS   (jump with grep -n "<anchor>" scenes.js)
//    SCENES ......... "export const SCENES"      names, defaults, periods
//    normParams ..... "export function normParams"
//    drawScene ...... "export function drawScene"
//    pairLayout ..... "export function pairLayout"   for the pluck hit test
//    objectStageAt .. "export function objectStageAt"
//    objectLayout ... "export function objectLayout"
//    termTiles ...... "export function termTiles"    tiles and tap targets
//    scene bodies ... "function scenePair"  "function sceneSwap"
//                     "function sceneRead"  "function sceneShared"
//                     "function sceneObject"
// ============================================================================
import {
  dirColor, alpha, lerp, lerpP, clamp01, ease, ramp, linkFrame, canonN, dotPos, strandPoints,
  strokeStrand, pointAt, drawBoard, drawEnd, bead, ring, text, tag, phasor, measure,
} from './paint.js';
import { mubs, farStates, objectState, pathAmplitudes, fmt } from './quantum.js';

export const SCENES = {
  pair: { defaults: { d1: 3, d2: 2 }, period: 0 },
  swap: { defaults: { d: 3 }, period: 13 },
  read: { defaults: { link: 'qutrit-qubit', basis: 0 }, period: 0 },
  shared: { defaults: { k: 3, copies: 'auto' }, period: 15 },
  object: { defaults: { stage: 'auto' }, period: 35 },
};

export const OBJECT_STAGES = ['knot', 'strands', 'paths', 'terms', 'weights'];
const STAGE_S = 7;

const NAMES = { 1: 'd = 1', 2: 'qubit', 3: 'qutrit', 4: 'ququart' };
const SUB = '₀₁₂₃₄₅₆₇₈₉';
const sub = n => String(n).split('').map(c => SUB[+c]).join('');

const READ_LINKS = {
  'qutrit-qubit': { dr: 3, df: 2, nameR: 'qutrit', nameF: 'qubit' },
  'qubit-qutrit': { dr: 2, df: 3, nameR: 'qubit', nameF: 'qutrit' },
  'qubit-qubit': { dr: 2, df: 2, nameR: 'qubit', nameF: 'qubit' },
};

const clampInt = (v, a, b, dflt) => { const n = Math.round(+v); return Number.isFinite(n) ? Math.max(a, Math.min(b, n)) : dflt; };
const mod = (x, p) => ((x % p) + p) % p;

/** Fill defaults and clamp every parameter of a scene. Unknown scene -> 'pair'. */
export function normParams(name, p = {}) {
  const sc = SCENES[name] ? name : 'pair';
  const q = { ...SCENES[sc].defaults, ...(p || {}) };
  if (sc === 'pair') {
    if (p && p.d != null && p.d1 == null) { q.d1 = p.d; q.d2 = p.unequal ? (p.d === 2 ? 3 : 2) : p.d; }
    q.d1 = clampInt(q.d1, 1, 4, 3); q.d2 = clampInt(q.d2, 1, 4, 2);
  } else if (sc === 'swap') q.d = clampInt(q.d, 2, 4, 3);
  else if (sc === 'read') {
    if (!READ_LINKS[q.link]) q.link = 'qutrit-qubit';
    q.basis = clampInt(q.basis, 0, READ_LINKS[q.link].dr, 0);
  } else if (sc === 'shared') {
    q.k = clampInt(q.k, 1, 4, 3);
    if (q.copies !== 'auto') q.copies = q.copies ? 1 : 0;
  } else if (sc === 'object') {
    if (q.stage !== 'auto' && !OBJECT_STAGES.includes(q.stage)) q.stage = 'auto';
  }
  return { name: sc, params: q };
}

export function drawScene(g, name, params, t, rect, env) {
  const { name: sc, params: p } = normParams(name, params);
  const th = env.th;
  drawBoard(g, th, rect);
  g.save();
  g.beginPath(); g.rect(rect.x, rect.y, rect.w, rect.h); g.clip();
  let out;
  if (sc === 'pair') out = scenePair(g, th, p, t, rect, env);
  else if (sc === 'swap') out = sceneSwap(g, th, p, t, rect, env);
  else if (sc === 'read') out = sceneRead(g, th, p, t, rect, env);
  else if (sc === 'shared') out = sceneShared(g, th, p, t, rect, env);
  else out = sceneObject(g, th, p, t, rect, env);
  g.restore();
  return { scene: sc, ...out };
}

// Draw the threads of one link between end centres A and B. Thread i runs
// from direction dot i of A to direction dot i of B; the dots lie along the
// end normals nA, nB (default: the link normal turned to point down), the
// same normals drawEnd uses, so a thread always lands on its own dot.
// o.dotsA / o.dotsB (arrays of points) override the dot positions.
// Returns the thread paths (index = direction) for i < m.
function drawLink(g, th, A, B, dA, dB, sp, o = {}) {
  const m = Math.min(dA, dB), f = linkFrame(A, B), out = [];
  const amp = 1 / Math.sqrt(m);
  const nA = o.nA || canonN(f), nB = o.nB || canonN(f);
  for (let i = 0; i < m; i++) {
    const a = o.dotsA ? o.dotsA[i] : dotPos(A, nA, i, dA, sp);
    const b = o.dotsB ? o.dotsB[i] : dotPos(B, nB, i, dB, sp);
    const pl = o.pluck ? o.pluck(i) : 0;
    const path = strandPoints(A, B, {
      a, b, R: o.R ?? sp * 0.36, theta: (2 * Math.PI * i) / m, twist: o.twist ?? Math.max(0.6, f.L / 140),
      phase: o.phase || 0, gather: o.gather ?? 1, bow: o.bow || 0, pluck: pl, n: o.n || 44,
    }).pts;
    out.push(path);
    const hi = o.hi ? o.hi(i) : 1;
    strokeStrand(g, th, path, o.color ? o.color(i) : dirColor(th, i), {
      width: (o.width || 1.7) * (0.75 + 0.5 * amp), a: (o.a ?? 1) * hi, dash: o.dash, from: o.from, to: o.to,
    });
  }
  return { paths: out, frame: f, m };
}

function unitFor(r) { return Math.min(r.w / 640, r.h / 400); }

// ---------------------------------------------------------------------------
// pair
// ---------------------------------------------------------------------------
export function pairLayout(r, p) {
  const narrow = r.w < 480;
  const cy = r.y + r.h * (narrow ? 0.40 : 0.42);
  const sp = Math.max(17, Math.min(34, r.h * 0.105));
  return {
    A: { x: r.x + r.w * (narrow ? 0.15 : 0.18), y: cy },
    B: { x: r.x + r.w * (narrow ? 0.85 : 0.82), y: cy },
    sp, narrow, cy,
    band: { y0: cy - sp * 2.4, y1: cy + sp * 2.4 },
  };
}

function scenePair(g, th, p, t, r, env) {
  const L = pairLayout(r, p), { A, B, sp } = L;
  const d1 = p.d1, d2 = p.d2, m = Math.min(d1, d2), amp = 1 / Math.sqrt(m);
  const product = m < 2 || Math.max(d1, d2) < 2;
  const plucks = (env.live && env.live.plucks) || [];
  const pluck = i => {
    let s = 0;
    for (const k of plucks) {
      const dt = t - k.t0;
      if (dt < 0 || dt > 4) continue;
      s += k.amp * Math.exp(-1.6 * dt) * Math.cos(15 * dt + i * 0.9);
    }
    return s;
  };
  const f = linkFrame(A, B);
  let paths = [];
  if (!product) {
    paths = drawLink(g, th, A, B, d1, d2, sp, { phase: 0.55 * t, pluck, width: 1.9 }).paths;
    // beads: the amplitude travelling along each thread, both ways
    for (let i = 0; i < m; i++) {
      for (const dir of [0, 1]) {
        const s = mod(0.16 * t + i / m + dir * 0.5, 1);
        const q = pointAt(paths[i], dir ? 1 - s : s);
        bead(g, th, q, 1.6 + 1.6 * amp, dirColor(th, i), 0.55 + 0.45 * (q.z + 1) / 2);
      }
    }
  } else {
    // one direction each side: a product state, not a pair
    const a = dotPos(A, f, 0, d1, sp), b = dotPos(B, f, 0, d2, sp);
    const path = strandPoints(a, b, { R: 0, gather: 0, n: 30 }).pts;
    strokeStrand(g, th, path, th.dim, { width: 1.2, a: 0.6, dash: [5, 6] });
  }
  drawEnd(g, th, A, { d: d1, sp, n: f, hollowFrom: m, label: NAMES[d1], sub: L.narrow ? '' : `d${sub(1)} = ${d1}` });
  drawEnd(g, th, B, { d: d2, sp, n: f, hollowFrom: m, label: NAMES[d2], sub: L.narrow ? '' : `d${sub(2)} = ${d2}` });

  // unmatched directions
  if (!product && d1 !== d2) {
    const big = d1 > d2 ? A : B, dB = Math.max(d1, d2);
    const side = d1 > d2 ? 1 : -1;
    for (let i = m; i < dB; i++) {
      const q = dotPos(big, f, i, dB, sp);
      text(g, th, 'meets no thread', q.x + side * sp * 0.75, q.y + 4, { size: 11, color: th.dim, align: side > 0 ? 'left' : 'right', a: 0.9 });
    }
  }

  const mid = { x: (A.x + B.x) / 2, y: L.cy - sp * (Math.max(d1, d2) / 2 + 1.25) };
  if (product) {
    tag(g, th, 'a one-direction system cannot be entangled: no pair', mid.x, mid.y, { size: L.narrow ? 10.5 : 12, color: th.zero });
  } else {
    tag(g, th, `${m} threads, each 1/√${m} ≈ ${fmt(amp, 3)}`, mid.x, mid.y, { size: L.narrow ? 11.5 : 12.5, color: th.accent, serif: true });
  }

  // the two sums: amplitudes add to √m, Born weights to 1 (Theorem S1)
  const W = Math.min(r.w * 0.78, 460), x0 = r.x + (r.w - W) / 2;
  const y1 = r.y + r.h * 0.74, y2 = y1 + Math.max(30, r.h * 0.11);
  const scale = W / 2; // full bar width is 2 = √4
  const bars = [
    { y: y1, seg: product ? 1 : amp, label: product ? 'amplitude 1' : `amplitudes: ${m} · 1/√${m} = √${m} ≈ ${fmt(Math.sqrt(m), 3)}` },
    { y: y2, seg: product ? 1 : 1 / m, label: product ? 'Born weight 1' : `Born weights: ${m} · 1/${m} = 1` },
  ];
  const n = product ? 1 : m;
  for (const b of bars) {
    text(g, th, b.label, x0, b.y - 8, { size: L.narrow ? 11 : 12, color: th.dim, serif: true });
    g.save();
    g.strokeStyle = alpha(th.dim, 0.3); g.lineWidth = 1;
    g.strokeRect(x0, b.y, W, 8);
    let x = x0;
    for (let i = 0; i < n; i++) {
      const w = b.seg * scale;
      const grow = ease(clamp01((t % 6) / 1.2 - i * 0.15));
      g.fillStyle = alpha(product ? th.dim : dirColor(th, i), 0.85);
      g.fillRect(x + 1, b.y + 1, Math.max(0, w * grow - 2), 6);
      x += w;
    }
    // tick at 1
    g.fillStyle = alpha(th.ink, 0.6);
    g.fillRect(x0 + scale - 0.5, b.y - 3, 1, 14);
    g.restore();
  }
  text(g, th, '1', x0 + scale, y2 + 24, { size: 10.5, color: th.dim, align: 'center' });
  text(g, th, '2', x0 + W, y2 + 24, { size: 10.5, color: th.dim, align: 'center' });
  return { step: 0, stepCount: 1, layout: L };
}

// ---------------------------------------------------------------------------
// swap, Eq. (S1)
// ---------------------------------------------------------------------------
function resample(pts, n) {
  // even resampling by arc length
  const L = [0];
  for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const tot = L[L.length - 1] || 1, out = [];
  let j = 0;
  for (let k = 0; k < n; k++) {
    const s = (k / (n - 1)) * tot;
    while (j < L.length - 2 && L[j + 1] < s) j++;
    const u = (s - L[j]) / ((L[j + 1] - L[j]) || 1);
    const a = pts[j], b = pts[j + 1] || a;
    out.push({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, z: (a.z || 0) * (1 - u) + (b.z || 0) * u });
  }
  return out;
}

function sceneSwap(g, th, p, t, r, env) {
  const d = p.d, T = SCENES.swap.period, u = mod(t, T);
  const narrow = r.w < 480;
  const sp = Math.max(15, Math.min(28, r.h * 0.085));
  const yTop = r.y + r.h * 0.34, yLow = r.y + r.h * 0.70;
  const X = [0.09, 0.37, 0.63, 0.91].map(x => r.x + r.w * x);
  const tie = ramp(u, 2.6, 4.2), route = ramp(u, 4.8, 7.8), fade = 1 - ramp(u, 12.0, T);
  const step = u < 2.6 ? 0 : u < 4.8 ? 1 : u < 8.2 ? 2 : 3;
  const P1 = { x: X[0], y: yTop }, P4 = { x: X[3], y: yTop };
  const P2a = { x: X[1], y: yTop }, P3a = { x: X[2], y: yTop };
  const P2b = { x: r.x + r.w * 0.40, y: yLow }, P3b = { x: r.x + r.w * 0.60, y: yLow };
  const P2 = lerpP(P2a, P2b, route), P3 = lerpP(P3a, P3b, route);
  const hor = linkFrame(P1, P4);
  const amp = 1 / Math.sqrt(d);
  g.save();
  g.globalAlpha = fade;

  const N = 44;
  const arcBow = -r.h * 0.13;
  for (let i = 0; i < d; i++) {
    const oi = (i - (d - 1) / 2) * sp;
    const a = strandPoints(P1, P2a, { oA: oi, oB: oi, R: sp * 0.32, theta: (2 * Math.PI * i) / d, phase: 0.5 * t, n: N }).pts;
    const tiePts = strandPoints(dotPos(P2a, hor, i, d, sp), dotPos(P3a, hor, i, d, sp), { R: 0, gather: 0, bow: -sp * 0.2, n: 12 }).pts;
    const b = strandPoints(P3a, P4, { oA: oi, oB: oi, R: sp * 0.32, theta: (2 * Math.PI * i) / d, phase: 0.5 * t, n: N }).pts;
    const src = [...a, ...tiePts.slice(1), ...b.slice(1)];
    const target = resample(strandPoints(P1, P4, { oA: oi, oB: oi, R: sp * 0.3, theta: (2 * Math.PI * i) / d, twist: 2.2, phase: 0.5 * t, bow: arcBow, n: 120 }).pts, src.length);
    const pts = src.map((q, k) => ({ x: lerp(q.x, target[k].x, route), y: lerp(q.y, target[k].y, route), z: lerp(q.z || 0, target[k].z || 0, route) }));
    const col = dirColor(th, i);
    if (route <= 0.001) {
      strokeStrand(g, th, a, col, { width: 1.8 });
      strokeStrand(g, th, b, col, { width: 1.8 });
      if (tie > 0) strokeStrand(g, th, tiePts, col, { width: 1.5, a: tie, dash: [3, 3] });
    } else {
      strokeStrand(g, th, pts, col, { width: 1.8 });
    }
    // beads during the route step: one per route, crossing three amplitudes
    if (step === 2 || step === 3) {
      const s = mod((u - 4.8) / 3.2 + i * 0.13, 1);
      bead(g, th, pointAt(pts, s), 2.6, col, 0.9);
    }
  }
  // blocked crossings at the tie: direction i at 2 never meets j ≠ i at 3
  if (tie > 0 && route < 1) {
    for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) {
      if (i === j) continue;
      const q2 = dotPos(P2a, hor, i, d, sp), q3 = dotPos(P3a, hor, j, d, sp);
      const k = Math.sin(Math.PI * clamp01(tie * 1.4)) * (1 - route);
      g.save();
      g.strokeStyle = alpha(th.zero, 0.35 * k); g.setLineDash([2, 4]); g.lineWidth = 1;
      g.beginPath(); g.moveTo(q2.x, q2.y); g.lineTo(q3.x, q3.y); g.stroke();
      g.restore();
    }
  }
  // the new pair 2-3 (projected) below
  if (route > 0) {
    drawLink(g, th, P2, P3, d, d, sp, { phase: 0.5 * t, a: route, width: 1.6 });
  }
  // tie ring around 2 and 3
  const ringC = lerpP({ x: (P2a.x + P3a.x) / 2, y: yTop }, { x: (P2b.x + P3b.x) / 2, y: yLow }, route);
  ring(g, th, ringC, (P3a.x - P2a.x) / 2 + sp * 1.1 - route * ((P3a.x - P3b.x)), sp * (d / 2 + 0.7), th.read, tie, { dash: [6, 4], width: 1.6, a: 0.9 });

  const ends = [[P1, '1'], [P2, '2'], [P3, '3'], [P4, '4']];
  for (const [P, lab] of ends) drawEnd(g, th, P, { d, sp, n: hor, label: lab, labelSize: 14, sub: '', labelSide: (lab === '2' || lab === '3') && route > 0.5 ? 1 : 1 });

  // tags
  const fs = narrow ? 11 : 12.5;
  const topY = r.y + r.h * 0.08;
  if (step === 0) {
    tag(g, th, `|ω⟩${sub(12)} |ω⟩${sub(34)}, each thread 1/√${d}`, r.x + r.w / 2, topY, { size: fs, serif: true, color: th.accent });
  } else if (step === 1) {
    tag(g, th, `distill 2 and 3: project onto |ω⟩${sub(23)}`, r.x + r.w / 2, topY, { size: fs, serif: true, color: th.read });
  } else if (step === 2) {
    tag(g, th, `each route: (1/√${d})³ = ${d}^(-3/2) ≈ ${fmt(amp ** 3, 3)}`, r.x + r.w / 2, topY, { size: fs, serif: true, color: th.accent });
  } else {
    tag(g, th, `${d} routes: (1/${d}) |ω⟩${sub(14)}   and   |ω⟩${sub(23)}`, r.x + r.w / 2, topY, { size: fs, serif: true, color: th.accent });
    text(g, th, `in a lab: this outcome has probability 1/${d}² = ${fmt(1 / (d * d), 3)}`, r.x + r.w / 2, r.y + r.h * 0.95, { size: narrow ? 10.5 : 11.5, color: th.dim, align: 'center' });
  }
  g.restore();
  return { step, stepCount: 4 };
}

// ---------------------------------------------------------------------------
// read, Corollary S3
// ---------------------------------------------------------------------------
function sceneRead(g, th, p, t, r, env) {
  const L = READ_LINKS[p.link], { dr, df } = L, m = Math.min(dr, df);
  const narrow = r.w < 480;
  const bases = mubs(dr), basis = bases[p.basis] || bases[0];
  const far = farStates(dr, df, basis.basis);
  const sp = Math.max(17, Math.min(30, r.h * 0.095));
  const cy = r.y + r.h * 0.33;
  const A = { x: r.x + r.w * (narrow ? 0.26 : 0.24), y: cy }, B = { x: r.x + r.w * (narrow ? 0.74 : 0.76), y: cy };
  const f = linkFrame(A, B);
  const D = 2.8, n = Math.floor(t / D), e = mod(n, dr), tau = mod(t, D) / D;
  const el = basis.basis[e], fe = far[e];
  const paths = drawLink(g, th, A, B, dr, df, sp, { phase: 0.4 * t, width: 1.6, a: 0.75 });
  // pulses: component i of e goes down thread i (only i < m have a thread)
  const go = ramp(tau, 0.12, 0.62);
  for (let i = 0; i < dr; i++) {
    const mag = Math.hypot(el[i][0], el[i][1]);
    if (mag < 1e-9) continue;
    if (i < m) {
      bead(g, th, pointAt(paths.paths[i], go), 1.8 + 2.4 * mag, dirColor(th, i), (tau < 0.7 ? 1 : 1 - ramp(tau, 0.7, 0.9)));
    } else {
      // stops at the read end: no thread for this direction
      const q = dotPos(A, f, i, dr, sp);
      ring(g, th, q, sp * 0.45 + go * sp * 0.3, sp * 0.45 + go * sp * 0.3, th.zero, 1, { a: 0.8 * (1 - go), width: 1.4 });
    }
  }
  drawEnd(g, th, A, { d: dr, sp, n: f, hollowFrom: m, label: L.nameR, sub: 'read here', read: th.read });
  drawEnd(g, th, B, { d: df, sp, n: f, hollowFrom: m, label: L.nameF, sub: 'far end' });
  // phasor columns
  const rr = Math.max(8, sp * 0.4);
  const colX = A.x - sp * (narrow ? 1.25 : 1.5), farX = B.x + sp * (narrow ? 1.25 : 1.5);
  for (let i = 0; i < dr; i++) {
    const q = dotPos({ x: colX, y: cy }, f, i, dr, sp);
    phasor(g, th, q, rr, el[i][0], el[i][1], dirColor(th, i), 1);
  }
  const show = ramp(tau, 0.55, 0.75);
  for (let i = 0; i < df; i++) {
    const q = dotPos({ x: farX, y: cy }, f, i, df, sp);
    phasor(g, th, q, rr, fe.re[i] * show, fe.im[i] * show, dirColor(th, i), 0.35 + 0.65 * show);
  }
  const fs = narrow ? 11 : 12;
  text(g, th, `e${sub(e + 1)}`, colX, cy - sp * (dr / 2 + 0.4) - 6, { size: 13, serif: true, italic: true, align: 'center', color: th.ink });
  text(g, th, `⟨e${sub(e + 1)}|ω⟩`, farX, cy - sp * (df / 2 + 0.4) - 6, { size: 13, serif: true, align: 'center', color: th.ink, a: 0.4 + 0.6 * show });
  const zero = fe.norm < 1e-9;
  const below = cy + sp * (df / 2) + sp * 0.55 + 46;
  if (zero && show > 0.5) tag(g, th, 'zero vector', Math.min(farX, r.x + r.w - 46), below, { size: 11, color: th.zero, a: show });
  if (df > dr) {
    const q = dotPos(B, f, df - 1, df, sp);
    ring(g, th, q, sp * 0.42, sp * 0.42, th.zero, 1, { a: 0.5 + 0.3 * Math.sin(3 * t), width: 1.2, dash: [2, 3] });
    text(g, th, 'third direction: never reached', B.x, below + 4, { size: 10.5, color: th.zero, align: 'center', a: 0.95, box: r });
  }
  const bname = dr === 2 ? `${basis.name} basis` : (p.basis === 0 ? 'standard basis' : `Fourier basis ${p.basis}`);
  tag(g, th, `${bname} (${p.basis + 1} of ${dr + 1})`, r.x + r.w / 2, r.y + r.h * 0.07, { size: fs, color: th.read });

  // row of all far states of this basis
  const rowY = Math.max(r.y + r.h * 0.74, cy + sp * (Math.max(dr, df) / 2) + 118);
  const cw = Math.min(r.w / (dr + 0.4), 140);
  const x0 = r.x + r.w / 2 - (cw * dr) / 2 + cw / 2;
  text(g, th, 'far-end states of the whole basis', r.x + r.w / 2, rowY - sp * (df / 2) - 22, { size: fs, align: 'center', color: th.dim });
  for (let k = 0; k < dr; k++) {
    const cx = x0 + k * cw, on = k === e;
    const st = far[k];
    if (on) {
      g.save(); g.fillStyle = alpha(th.read, 0.12);
      g.fillRect(cx - cw / 2 + 4, rowY - sp * (df / 2) - 8, cw - 8, sp * df + 46); g.restore();
    }
    for (let i = 0; i < df; i++) {
      const q = dotPos({ x: cx, y: rowY }, f, i, df, sp * 0.8);
      phasor(g, th, q, rr * 0.75, st.re[i], st.im[i], dirColor(th, i), on ? 1 : 0.6);
    }
    const lab = st.norm < 1e-9 ? 'length 0' : `length ${fmt(st.norm, 3)}`;
    text(g, th, `e${sub(k + 1)} → ${lab}`, cx, rowY + sp * 0.8 * (df / 2) + 18, { size: narrow ? 10 : 11, align: 'center', color: st.norm < 1e-9 ? th.zero : th.dim });
  }
  return { step: 0, stepCount: 1, element: e };
}

// ---------------------------------------------------------------------------
// shared
// ---------------------------------------------------------------------------
function sceneShared(g, th, p, t, r, env) {
  const T = SCENES.shared.period, u = mod(t, T), k = p.k;
  const narrow = r.w < 480;
  const C = { x: r.x + r.w / 2, y: r.y + r.h * 0.53 };
  const sp = Math.max(13, Math.min(22, r.h * 0.062));
  const R = Math.min(r.w * 0.5 - sp * 3.1, r.h * 0.35);
  const c = p.copies === 'auto' ? ramp(u, 2.2, 4.2) * (1 - ramp(u, 13.0, 14.6)) : p.copies;
  // two exchanges, which together are no exchange
  const ex1 = ramp(u, 5.2, 7.4), ex2 = ramp(u, 9.0, 11.2);
  const ex = k >= 2 ? (ex1 - ex2) : 0;
  const step = c < 0.5 ? 0 : (u > 5.0 && u < 11.6 && k >= 2) ? 2 : 1;
  const off = k === 4 ? Math.PI / 4 : 0;
  const ang0 = j => (k === 1 ? Math.PI : Math.PI + off + (2 * Math.PI * j) / k);
  const angles = [], rad = new Array(k).fill(R);
  for (let j = 0; j < k; j++) angles.push(ang0(j));
  if (k >= 2 && ex !== 0) {
    // links 0 and 1 trade places, 0 passing outside and 1 inside
    const a0 = ang0(0), a1 = ang0(1), da = a1 - a0;
    // two links: they pass on opposite sides; more: link 1 goes back inside
    angles[0] = a0 + da * ex; angles[1] = k === 2 ? a1 + (2 * Math.PI - da) * ex : a1 - da * ex;
    const bump = Math.sin(Math.PI * Math.abs(ex));
    if (k > 2) { rad[0] = R * (1 + 0.2 * bump); rad[1] = R * (1 - 0.3 * bump); }
  }
  const names = ['q₁', 'q₂', 'q₃', 'q₄'];
  const discR = sp * (1.9 + 1.7 * c);
  g.save();
  g.fillStyle = alpha(th.read, 0.05 + 0.05 * (1 - c));
  g.strokeStyle = alpha(th.read, 0.5);
  g.setLineDash([5, 5]); g.lineWidth = 1.3;
  g.beginPath(); g.arc(C.x, C.y, discR, 0, Math.PI * 2); g.fill(); g.stroke();
  g.restore();
  const n0 = { nx: 0, ny: 1 };
  const oneDots = [0, 1, 2].map(i => dotPos(C, n0, i, 3, sp));
  for (let j = 0; j < k; j++) {
    const dir = { x: Math.cos(angles[j]), y: Math.sin(angles[j]) };
    const Pj = { x: C.x + dir.x * rad[j], y: C.y + dir.y * rad[j] };
    const Cj = { x: C.x + dir.x * sp * 2.3 * c, y: C.y + dir.y * sp * 2.3 * c };
    const nj = canonN(linkFrame(C, Pj));
    const copyDots = [0, 1, 2].map(i => dotPos(Cj, nj, i, 3, sp));
    const dotsA = [0, 1].map(i => lerpP(oneDots[i], copyDots[i], c));
    drawLink(g, th, lerpP(C, Cj, c), Pj, 3, 2, sp, { dotsA, nB: nj, phase: 0.5 * t + j, width: 1.5, a: 0.6 + 0.4 * c, R: sp * 0.3, n: 36 });
    drawEnd(g, th, Pj, { d: 2, sp, n: nj });
    text(g, th, names[j], Pj.x + dir.x * sp * 2.1, Pj.y + dir.y * sp * 2.1 + 5, { size: 14, serif: true, italic: true, align: 'center', color: th.ink, box: r });
    if (c > 0.02) drawEnd(g, th, Cj, { d: 3, sp, n: nj, hollowFrom: 2, a: c });
  }
  if (c < 0.98) {
    drawEnd(g, th, C, { d: 3, sp, n: n0, hollowFrom: 3, a: 1 - c });
    if (k >= 2) tag(g, th, `${k} links on the same three dots?`, C.x, C.y + discR + 18, { size: narrow ? 10.5 : 11.5, color: th.zero, a: (1 - c) * 0.95 });
  }
  const fs = narrow ? 11 : 12.5;
  const topY = r.y + r.h * 0.06;
  if (step === 0) tag(g, th, `one qutrit at the end of ${k} link${k > 1 ? 's' : ''}`, C.x, topY, { size: fs, color: th.ink });
  else if (step === 1) tag(g, th, 'one copy per link, each paired with its own partner', C.x, topY, { size: fs, color: th.read });
  else tag(g, th, ex2 > 0 ? 'the same exchange again: no exchange' : 'exchange two links: only the far ends move', C.x, topY, { size: fs, color: th.accent });
  if (c > 0.5) text(g, th, 'one qudit', C.x, C.y + discR + 16, { size: 11.5, color: th.read, align: 'center', a: c });
  return { step, stepCount: 3 };
}

// ---------------------------------------------------------------------------
// object, Theorem 1 and Sec. S7
// ---------------------------------------------------------------------------
export function objectStageAt(p, t) {
  if (p.stage && p.stage !== 'auto') return { stage: p.stage, local: t, idx: OBJECT_STAGES.indexOf(p.stage) };
  const T = STAGE_S * OBJECT_STAGES.length, u = mod(t, T);
  const idx = Math.floor(u / STAGE_S);
  return { stage: OBJECT_STAGES[idx], local: u - idx * STAGE_S, idx };
}

let OBJ = null;
function objectData() {
  if (!OBJ) {
    const o = objectState();
    OBJ = { state: o, paths: pathAmplitudes(), terms: o.terms };
  }
  return OBJ;
}

/** Positions of the object's ends at a stage (morph 0 = knot, 1 = strands). */
export function objectLayout(r, stage, mph) {
  const cx = r.x + r.w / 2, termsStage = stage === 'terms';
  const rowY = r.y + r.h * (termsStage ? 0.27 : 0.33);
  const Q3y = rowY + r.h * (termsStage ? 0.20 : 0.25);
  const fy = Q3y + r.h * (termsStage ? 0.16 : 0.22);
  const kY = r.y + r.h * 0.40;
  const knot = {
    Q: { x: cx, y: kY },
    q1: { x: r.x + r.w * 0.12, y: kY - r.h * 0.08 }, q2: { x: r.x + r.w * 0.88, y: kY - r.h * 0.08 },
    f: { x: cx, y: kY + r.h * 0.36 },
  };
  const st = {
    q1: { x: r.x + r.w * 0.08, y: rowY }, Q1: { x: r.x + r.w * 0.32, y: rowY },
    Q2: { x: r.x + r.w * 0.68, y: rowY }, q2: { x: r.x + r.w * 0.92, y: rowY },
    Q3: { x: cx, y: Q3y }, f: { x: cx, y: fy },
  };
  return {
    cx, rowY, knot, st,
    q1: lerpP(knot.q1, st.q1, mph), q2: lerpP(knot.q2, st.q2, mph), f: lerpP(knot.f, st.f, mph),
    Q1: lerpP(knot.Q, st.Q1, mph), Q2: lerpP(knot.Q, st.Q2, mph), Q3: lerpP(knot.Q, st.Q3, mph),
  };
}

function sceneObject(g, th, p, t, r, env) {
  const { stage, local, idx } = objectStageAt(p, t);
  const narrow = r.w < 480;
  const data = objectData();
  const sp = Math.max(13, Math.min(25, r.h * 0.066));
  const termsStage = stage === 'terms', weights = stage === 'weights';
  const mph = stage === 'knot' ? 0 : stage === 'strands' ? ramp(local, 0.2, 2.0) : 1;
  const Lo = objectLayout(r, stage, mph), cx = Lo.cx, rowY = Lo.rowY;
  const pos = { q1: Lo.q1, q2: Lo.q2, f: Lo.f, Q1: Lo.Q1, Q2: Lo.Q2, Q3: Lo.Q3 };
  // the mirror (weights stage): the read row flips about the centre line
  if (weights) {
    const flip = ramp(local, 1.0, 2.2) - ramp(local, 4.6, 5.8);
    const sx = Math.cos(Math.PI * flip);
    for (const key of ['q1', 'Q1', 'Q2', 'q2']) pos[key] = { x: cx + (pos[key].x - cx) * sx, y: pos[key].y };
  }
  // end normals: copies Q1, Q2 and the read qubits stand upright; Q3 and f lie flat
  const up = { nx: 0, ny: 1 };
  const nQ3 = canonN(linkFrame(pos.Q3, pos.f));
  const nq1 = canonN(linkFrame(pos.q1, pos.Q1)), nq2 = canonN(linkFrame(pos.Q2, pos.q2)), nf = nQ3;
  const knotDots = [0, 1, 2].map(i => dotPos(Lo.knot.Q, up, i, 3, sp));
  const copyDots = (P, n) => [0, 1, 2].map(i => lerpP(knotDots[i], dotPos(P, n, i, 3, sp), mph));
  const d1 = copyDots(pos.Q1, up), d2 = copyDots(pos.Q2, up), d3 = copyDots(pos.Q3, nQ3);

  // the shared qutrit as one, before the split
  if (mph < 1) {
    g.save();
    g.globalAlpha = 1 - mph;
    g.fillStyle = alpha(th.read, 0.07); g.strokeStyle = alpha(th.read, 0.55);
    g.setLineDash([5, 5]); g.lineWidth = 1.3;
    g.beginPath(); g.arc(Lo.knot.Q.x, Lo.knot.Q.y, sp * 2.4, 0, Math.PI * 2); g.fill(); g.stroke();
    g.restore();
    text(g, th, 'shared qutrit Q', Lo.knot.Q.x, Lo.knot.Q.y - sp * 2.4 - 8, { size: 12.5, serif: true, italic: true, align: 'center', color: th.read, a: 1 - mph });
  }

  // which threads light up
  let route = -1, routeS = 0, term = null;
  if (stage === 'paths') { route = Math.floor(local / 3.5) % 2; routeS = clamp01(mod(local, 3.5) / 2.7); }
  const retie = termsStage ? ramp(local, 0.2, 2.0) : 0;
  if (termsStage) {
    const nT = data.terms.length;
    const ti = env.focus != null ? mod(env.focus, nT) : Math.floor(Math.max(0, local - 2.2) / 0.4) % nT;
    term = { ...data.terms[ti], index: ti };
  }
  const hiRead = i => (route >= 0 ? (i === route ? 1 : 0.2) : 1);
  const readA = termsStage ? 1 - 0.8 * retie : 1;
  const L1 = drawLink(g, th, pos.Q1, pos.q1, 3, 2, sp, { dotsA: d1, nB: nq1, phase: 0.45 * t, width: 1.6, hi: hiRead, a: readA });
  const L2 = drawLink(g, th, pos.Q2, pos.q2, 3, 2, sp, { dotsA: d2, nB: nq2, phase: 0.45 * t + 1, width: 1.6, hi: hiRead, a: readA });
  const hiUnread = i => (term ? (i === term.idx[5] ? 1 : 0.18) : route >= 0 ? 0.35 : 1);
  drawLink(g, th, pos.Q3, pos.f, 3, 2, sp, { dotsA: d3, nB: nf, phase: 0.45 * t + 2, width: 1.5, a: 0.85, hi: hiUnread });
  // the join |ω3⟩ between the read copies (Sec. S7)
  let J = null;
  if (mph > 0.02) {
    const hiJ = i => (route >= 0 ? (i === route ? 1 : 0.18) : term ? (i === term.idx[0] ? 1 : 0.18) : 1);
    J = drawLink(g, th, pos.Q1, pos.Q2, 3, 3, sp, { dotsA: d1, dotsB: d2, phase: -0.35 * t, width: 1.4, dash: [5, 4], a: mph, hi: hiJ });
  }
  // terms: after the join, q1 and q2 are a qubit pair (the bookkeeping of Eq. (S1))
  if (termsStage && retie > 0) {
    const hiQ = i => (term ? (i === term.idx[2] ? 1 : 0.18) : 1);
    drawLink(g, th, pos.q1, pos.q2, 2, 2, sp, { nA: nq1, nB: nq2, phase: 0.4 * t, bow: -r.h * 0.15, twist: 2.5, a: retie, width: 1.6, hi: hiQ });
  }
  // ends
  const lab = (s, P, dy, o = {}) => text(g, th, s, P.x, P.y + dy, { size: o.size || 14, serif: true, italic: true, align: 'center', color: o.color || th.ink, base: 'middle', a: o.a ?? 1 });
  drawEnd(g, th, pos.q1, { d: 2, sp, n: nq1 });
  drawEnd(g, th, pos.q2, { d: 2, sp, n: nq2 });
  drawEnd(g, th, pos.f, { d: 2, sp, n: nf });
  const qOff = -(sp * 1.6 + 12);
  lab('q₁', pos.q1, qOff); lab('q₂', pos.q2, qOff);
  if (!narrow) {
    text(g, th, 'read qubit', pos.q1.x, pos.q1.y + qOff - 16, { size: 11, color: th.dim, align: 'center' });
    text(g, th, 'read qubit', pos.q2.x, pos.q2.y + qOff - 16, { size: 11, color: th.dim, align: 'center' });
  }
  const fx = pos.f.x + sp * 1.7;
  text(g, th, 'f', fx, pos.f.y + 1, { size: 14, serif: true, italic: true, color: th.ink, base: 'middle' });
  text(g, th, narrow ? 'unread: the state' : 'unread link: the state', fx + 14, pos.f.y + 1, { size: 11, color: th.dim, base: 'middle', box: r });
  if (mph > 0.01) {
    drawEnd(g, th, pos.Q1, { d: 3, sp, n: up, hollowFrom: 2, read: th.read, a: mph });
    drawEnd(g, th, pos.Q2, { d: 3, sp, n: up, hollowFrom: 2, read: th.read, a: mph });
    drawEnd(g, th, pos.Q3, { d: 3, sp, n: nQ3, hollowFrom: 2, a: mph });
    const cOff = sp * 1.6 + 19;
    lab('Q₁', pos.Q1, cOff, { size: 13, a: mph }); lab('Q₂', pos.Q2, cOff, { size: 13, a: mph });
    text(g, th, 'Q₃', pos.Q3.x - sp * 2.0, pos.Q3.y + 1, { size: 13, serif: true, italic: true, align: 'right', base: 'middle', a: mph });
  }
  if (mph < 0.99) drawEnd(g, th, Lo.knot.Q, { d: 3, sp, n: up, a: 1 - mph });
  if (stage === 'knot') {
    text(g, th, 'read 1', (Lo.knot.Q.x + pos.q1.x) / 2, (Lo.knot.Q.y + pos.q1.y) / 2 + sp * 2.1, { size: 11.5, color: th.read, align: 'center' });
    text(g, th, 'read 2', (Lo.knot.Q.x + pos.q2.x) / 2, (Lo.knot.Q.y + pos.q2.y) / 2 + sp * 2.1, { size: 11.5, color: th.read, align: 'center' });
  }

  const fs = narrow ? 11 : 12.5;
  const topY = r.y + r.h * 0.06;
  const amp = data.paths[0].amp;
  const foot = (s, k = 0) => text(g, th, s, cx, r.y + r.h * (0.925 + 0.045 * k), { size: narrow ? 10.5 : 11.5, align: 'center', color: th.dim });
  if (stage === 'knot') {
    tag(g, th, 'two links read at the qutrit, one left unread', cx, topY, { size: fs, color: th.ink });
  } else if (stage === 'strands') {
    tag(g, th, 'the qutrit drawn as three copies, one per link', cx, topY, { size: fs, color: th.read });
    tag(g, th, 'join |ω₃⟩: 3 threads, each 1/√3', cx, rowY - sp * 2.9, { size: fs, serif: true, color: th.ink, a: mph });
  } else if (stage === 'paths' && J) {
    // a bead runs q1 -> Q1 -> Q2 -> q2 along direction `route`
    const seg = routeS * 3, k = Math.min(2, Math.floor(seg)), s = Math.min(1, seg - k);
    const path = k === 0 ? [...L1.paths[route]].reverse() : k === 1 ? J.paths[route] : L2.paths[route];
    bead(g, th, pointAt(path, s), 3, dirColor(th, route), 1);
    const facs = data.paths[route].factors, parts = ['1/√2', '1/√3', '1/√2'];
    const upto = Math.min(2, k);
    let v = 1; for (let i = 0; i <= upto; i++) v *= facs[i];
    const done = k === 2 && s > 0.6;
    tag(g, th, `route ${route + 1}: ${parts.slice(0, upto + 1).join(' · ')}${done ? ' = 1/(2√3)' : ''} ≈ ${fmt(v, 3)}`, cx, topY, { size: fs, serif: true, color: dirColor(th, route) });
    foot('two routes: |ω₂⟩ on q₁ q₂, divided by √6');
  } else if (termsStage) {
    drawTerms(g, th, data, term, r, narrow, retie);
    tag(g, th, `√6 × projection: ${data.terms.length} terms, each 1/(2√3) ≈ ${fmt(amp, 4)}`, cx, topY, { size: fs, serif: true, color: th.accent });
  } else if (weights) {
    tag(g, th, 'each exchange is a mirror of the drawing', cx, topY, { size: fs, color: th.ink });
    tag(g, th, 'X: over the join, 3 · 1/√3 = √3', cx, rowY - sp * 2.9, { size: fs, serif: true, color: th.accent });
    tag(g, th, 'Y: over a read link, 2 · 1/√2 = √2', cx, rowY + sp * 3.35, { size: fs, serif: true, color: th.accent });
    g.save(); g.strokeStyle = alpha(th.accent, 0.45); g.setLineDash([3, 5]); g.lineWidth = 1;
    g.beginPath(); g.moveTo(cx, rowY - sp * 2.2); g.lineTo(cx, rowY + sp * 2.2); g.stroke(); g.restore();
    const F = env.facts;
    if (F) {
      const sl = F.slots.map(q => `${q.id} ${q.letters}`).join(', ');
      foot(`letters per slot: ${sl}`, 0);
      foot(`N = ${String(F.N).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}${F.records ? `, ${F.records} records (computed by the model)` : ''}`, 1);
    }
  }
  return { step: Math.max(0, idx), stepCount: OBJECT_STAGES.length, stage, term: term ? term.index : null };
}

// Tile boxes of the 12 terms (also the tap targets of the terms stage).
export function termTiles(r, n) {
  const narrow = r.w < 480;
  const cols = narrow ? 4 : 6, rows = Math.ceil(n / cols);
  const tw = Math.min((r.w - 24) / cols, 92), thh = Math.min(r.h * 0.07, 32);
  const x0 = r.x + r.w / 2 - (cols * tw) / 2, y0 = r.y + r.h * 0.965 - rows * thh;
  const out = [];
  for (let k = 0; k < n; k++) out.push({ k, x: x0 + (k % cols) * tw, y: y0 + Math.floor(k / cols) * thh, w: tw, h: thh });
  return out;
}

// The 12 terms of Eq. (S2) as tiles. Factor order of a term:
// [Q1, Q2, q1, q2, Q3, f]; the join gives Q1 = Q2, the qubit pair q1 = q2,
// the unread link Q3 = f. Each tile shows the three directions as bars.
function drawTerms(g, th, data, term, r, narrow, a) {
  const T = data.terms, tiles = termTiles(r, T.length);
  for (const b of tiles) {
    const on = term && term.index === b.k, tm = T[b.k];
    g.save();
    g.globalAlpha = a;
    g.fillStyle = on ? alpha(th.accent, 0.2) : alpha(th.faint, 0.35);
    g.fillRect(b.x + 2, b.y + 2, b.w - 4, b.h - 4);
    const keys = [tm.idx[0], tm.idx[2], tm.idx[5]];
    const bw = Math.min(8, (b.w - 16) / 7);
    for (let j = 0; j < 3; j++) {
      g.fillStyle = dirColor(th, keys[j]);
      g.fillRect(b.x + 8 + j * (bw + 3), b.y + 8, bw, b.h - 16);
    }
    g.restore();
    text(g, th, '+' + fmt(tm.re, 3), b.x + b.w - 6, b.y + b.h / 2 + 1, { size: narrow ? 9.5 : 10.5, align: 'right', base: 'middle', color: on ? th.ink : th.dim, a });
  }
  text(g, th, 'each tile: join \u00b7 qubit pair \u00b7 unread link', r.x + r.w / 2, tiles[0].y - 8, { size: 10.5, align: 'center', color: th.dim, a });
}

export { measure };
