// ============================================================================
//  ALPHA QUDITS  ·  records/scenes/square.js  ·  the square of slots
// ----------------------------------------------------------------------------
//  The four slots of the object's two reads as the corners of a square:
//  the qutrit copies Q1, Q2 above, the read qubits q1, q2 below, read 1 on
//  the left and read 2 on the right. Each slot wears its letters as beads
//  (our letter glyph, draw.js). An edge is a pair of slots, not a link:
//  sparks run from every letter at one slot to every letter at the other,
//  and the edge counts its products. The arc under the qubits carries the
//  commutator records. The last step turns the square over in the mirror of
//  the swap of the reads: the solid edges land on themselves (X acts there)
//  and the dashed edges on each other (Y acts there). Every number is read
//  from records/data.js (MODEL).
//
//  grep -n targets:  const STEPS | function geom | function drawSquare |
//  function sparks | caption
// ============================================================================
import { SLOTS, SLOT, EDGES, PRODUCT_TERMS, RECORDS, COMMUTATORS } from '../data.js';
import { C, font, label, ease, clamp, lerp, rrect, drawLetter, slotColor } from '../draw.js';

const STEPS = [
  { id: 'slots', label: 'Slots', dur: 6 },
  { id: 'edges', label: 'Edges', dur: 13 },
  { id: 'arc', label: 'Arc', dur: 6 },
  { id: 'mirror', label: 'Mirror', dur: 9 },
];
const PRODUCT_EDGES = EDGES.filter(e => !e.arc);
const ARC = EDGES.find(e => e.arc);
const EDGE_T0 = 0.6, EDGE_SPAN = 2.0;   // seconds per edge in the 'edges' step

function geom(env) {
  const v = env.view;
  const L = Math.min(v.w * 0.58, v.h * 0.52, 340);
  const cx = v.x + v.w / 2, cy = v.y + v.h * 0.44;
  const R = clamp(L * 0.13, 19, 34);
  const pos = {
    Q1: [cx - L / 2, cy - L / 2], Q2: [cx + L / 2, cy - L / 2],
    q1: [cx - L / 2, cy + L / 2], q2: [cx + L / 2, cy + L / 2],
  };
  return { L, cx, cy, R, rr: clamp(R * 0.2, 3.4, 6.2), pos, arcY: cy + L / 2 + Math.max(46, L * 0.34) };
}
// Bead centre of letter i at a slot (x mirrored by fx about cx).
function bead(G, id, i, fx = 1) {
  const s = SLOT[id], [x, y] = G.pos[id];
  const a = -Math.PI / 2 + 2 * Math.PI * i / s.letters;
  return [G.cx + (x + G.R * Math.cos(a) - G.cx) * fx, y + G.R * Math.sin(a)];
}
const node = (G, id, fx = 1) => [G.cx + (G.pos[id][0] - G.cx) * fx, G.pos[id][1]];

// Time at which product k of edge e (in the 'edges' step) arrives.
function arrival(ei, k, n) { return EDGE_T0 + ei * EDGE_SPAN + (k / n) * EDGE_SPAN * 0.62 + 0.5; }
function counted(st) {
  if (st.step === 'slots') return { edges: PRODUCT_EDGES.map(() => 0), arc: 0 };
  if (st.step !== 'edges') return { edges: PRODUCT_EDGES.map(e => e.products), arc: st.step === 'arc' ? arcCount(st.stepT) : ARC.records };
  return {
    edges: PRODUCT_EDGES.map((e, ei) => {
      const n = e.products, t = st.stepT;
      if (t < arrival(ei, 0, n)) return 0;
      return Math.min(n, 1 + Math.floor((t - arrival(ei, 0, n)) / (EDGE_SPAN * 0.62 / n)));
    }),
    arc: 0,
  };
}
const arcArrival = k => 0.8 + k * 0.9 + 1.1;
function arcCount(t) { let c = 0; for (let k = 0; k < ARC.records; k++) if (t >= arcArrival(k)) c++; return c; }

function edgeEnds(G, e, fx) {
  const A = node(G, e.a, fx), B = node(G, e.b, fx);
  const dx = B[0] - A[0], dy = B[1] - A[1], l = Math.hypot(dx, dy) || 1, ux = dx / l, uy = dy / l, m = G.R + G.rr * 1.8;
  return [[A[0] + ux * m, A[1] + uy * m], [B[0] - ux * m, B[1] - uy * m]];
}
// Where an edge puts its count chip: diagonals at 30 % from their top end.
function chipAt(G, e, fx) {
  const [A, B] = edgeEnds(G, e, fx);
  if (SLOT[e.a].role !== SLOT[e.b].role && SLOT[e.a].read !== SLOT[e.b].read) {
    const top = A[1] < B[1] ? A : B, bot = A[1] < B[1] ? B : A;
    return [lerp(top[0], bot[0], 0.28), lerp(top[1], bot[1], 0.28)];
  }
  return [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
}

function chip(g, txt, x, y, col, on, px) {
  g.save();
  g.font = font(px, 600);
  const w = g.measureText(txt).width + 12, h = px + 9;
  rrect(g, x - w / 2, y - h / 2, w, h, h / 2);
  g.fillStyle = 'rgba(7,11,14,0.88)'; g.fill();
  g.strokeStyle = col; g.globalAlpha = 0.35 + 0.65 * on; g.lineWidth = 1; g.stroke();
  g.globalAlpha = 0.55 + 0.45 * on;
  g.fillStyle = on > 0.5 ? C.text : C.dim; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(txt, x, y + 0.5);
  g.restore();
}

function drawNode(g, G, id, fx, appear, t) {
  const s = SLOT[id], [x, y] = node(G, id, fx), col = slotColor(id);
  g.save();
  g.globalAlpha = appear;
  g.beginPath(); g.arc(x, y, G.R - G.rr * 1.4, 0, 7);
  g.fillStyle = 'rgba(7,11,14,0.9)'; g.fill();
  g.strokeStyle = col; g.lineWidth = 1.5; g.stroke();
  g.beginPath(); g.arc(x, y, G.R, 0, 7); g.strokeStyle = col; g.globalAlpha = appear * 0.18; g.lineWidth = G.rr * 2.6; g.stroke();
  g.globalAlpha = appear;
  label(g, id[0], x - 3, y, { font: font(Math.max(13, G.R * 0.62), 500, true), color: col });
  label(g, id[1], x + G.R * 0.26, y + G.R * 0.2, { font: font(11, 500, true), color: col });
  g.restore();
  for (let i = 0; i < s.letters; i++) {
    const a = clamp((appear * 1.4 - 0.4) * s.letters - i);
    if (a <= 0) continue;
    const [bx, by] = bead(G, id, i, fx);
    const pulse = 0.85 + 0.15 * Math.sin(t * 2 + i);
    drawLetter(g, s.d, i, bx, by, G.rr, col, { alpha: a * pulse });
  }
}

export function drawSquare(g, env, st, t, opts = {}) {
  const G = geom(env);
  const step = st.step, T = st.stepT;
  // mirror flip factor
  let fx = 1, flipU = 0;
  if (step === 'mirror') {
    flipU = ease(T, 1.0, 3.0) - ease(T, 6.0, 8.0);
    fx = Math.cos(Math.PI * flipU);
  }
  const appear = step === 'slots' ? ease(T, 0, 3.6) : 1;
  const cnt = counted(st);
  const nodeA = step === 'slots' ? ease(T, 0, 1.0) : 1;

  // the mirror of the swap of the reads
  const mirA = step === 'mirror' ? ease(T, 0, 0.8) : 0.25;
  g.save();
  g.strokeStyle = C.glass; g.globalAlpha = 0.25 + 0.5 * mirA; g.setLineDash([3, 5]); g.lineWidth = 1;
  g.beginPath(); g.moveTo(G.cx, G.cy - G.L / 2 - G.R - 16); g.lineTo(G.cx, G.arcY + 6); g.stroke();
  g.restore();
  if (step === 'mirror') {
    const gl = g.createLinearGradient(G.cx - 10, 0, G.cx + 10, 0);
    gl.addColorStop(0, 'rgba(191,230,255,0)'); gl.addColorStop(0.5, `rgba(191,230,255,${0.16 * mirA})`); gl.addColorStop(1, 'rgba(191,230,255,0)');
    g.fillStyle = gl; g.fillRect(G.cx - 10, G.cy - G.L / 2 - G.R - 16, 20, G.arcY - G.cy + G.L / 2 + G.R + 22);
  }

  // edges
  const hiX = step === 'mirror' ? ease(T, 3.0, 4.0) : 0;
  PRODUCT_EDGES.forEach((e, ei) => {
    const [A, B] = edgeEnds(G, e, fx);
    const full = cnt.edges[ei] / e.products;
    const active = step === 'edges' && T >= EDGE_T0 + ei * EDGE_SPAN && T < EDGE_T0 + (ei + 1) * EDGE_SPAN + 0.6;
    const hcol = e.solid ? C.x : C.y;
    g.save();
    g.setLineDash(e.solid ? [] : [6, 5]);
    g.lineWidth = e.solid ? 2 : 1.6;
    g.strokeStyle = hiX > 0 ? hcol : C.rec;
    g.globalAlpha = (0.16 + 0.6 * full + (active ? 0.2 : 0)) * nodeA;
    g.beginPath(); g.moveTo(A[0], A[1]); g.lineTo(B[0], B[1]); g.stroke();
    g.restore();
  });
  // arc
  {
    const A = node(G, ARC.a, fx), B = node(G, ARC.b, fx);
    const on = step === 'arc' ? ease(T, 0, 0.8) : step === 'mirror' ? 1 : 0;
    g.save();
    g.lineWidth = 2; g.strokeStyle = hiX > 0 ? C.alpha : C.rec; g.globalAlpha = 0.1 + 0.75 * on;
    g.beginPath(); g.moveTo(A[0], A[1] + G.R + 4); g.quadraticCurveTo((A[0] + B[0]) / 2, G.arcY + 18, B[0], B[1] + G.R + 4); g.stroke();
    g.restore();
  }

  // sparks: one per product, letter at one slot to letter at the other
  if (step === 'edges') {
    PRODUCT_EDGES.forEach((e, ei) => {
      const n = e.products;
      for (let k = 0; k < n; k++) {
        const ta = arrival(ei, k, n), ts = ta - 0.5, u = (T - ts) / 0.5;
        if (u < 0 || u > 1.35) continue;
        const i = Math.floor(k / e.nb), j = k % e.nb;
        const P = bead(G, e.a, i), Q = bead(G, e.b, j);
        const uu = clamp(u);
        const x = lerp(P[0], Q[0], uu), y = lerp(P[1], Q[1], uu);
        g.save();
        g.globalAlpha = u <= 1 ? 0.9 : (1.35 - u) / 0.35 * 0.5;
        g.strokeStyle = C.rec; g.lineWidth = 0.8;
        g.beginPath(); g.moveTo(P[0], P[1]); g.lineTo(x, y); g.globalAlpha *= 0.35; g.stroke(); g.globalAlpha /= 0.35;
        g.fillStyle = '#d9ffd2'; g.beginPath(); g.arc(x, y, 1.8, 0, 7); g.fill();
        g.restore();
      }
    });
  }
  if (step === 'arc') {
    const A = node(G, ARC.a), B = node(G, ARC.b);
    for (let k = 0; k < ARC.records; k++) {
      const u = (T - (arcArrival(k) - 1.1)) / 1.1;
      if (u < 0 || u > 1.4) continue;
      const uu = clamp(u), x0 = A[0], y0 = A[1] + G.R + 4, x2 = B[0], y2 = B[1] + G.R + 4, x1 = (x0 + x2) / 2, y1 = G.arcY + 18;
      const x = (1 - uu) ** 2 * x0 + 2 * (1 - uu) * uu * x1 + uu * uu * x2, y = (1 - uu) ** 2 * y0 + 2 * (1 - uu) * uu * y1 + uu * uu * y2;
      g.save(); g.globalAlpha = u <= 1 ? 1 : (1.4 - u) / 0.4;
      g.fillStyle = C.alpha; g.beginPath(); g.arc(x, y, 3, 0, 7); g.fill();
      g.globalAlpha *= 0.3; g.beginPath(); g.arc(x, y, 8, 0, 7); g.fill();
      g.restore();
      // the two letters it orders, lit at q1
      const c = COMMUTATORS[k];
      if (c && u < 1) for (const l of c.letters) { const P = bead(G, ARC.a, l); g.save(); g.strokeStyle = C.alpha; g.globalAlpha = 0.8 * (1 - u); g.beginPath(); g.arc(P[0], P[1], G.rr * 1.9, 0, 7); g.stroke(); g.restore(); }
    }
  }

  // nodes and beads
  for (const s of SLOTS) drawNode(g, G, s.id, fx, nodeA * (step === 'slots' ? appear : 1), t);

  // chips
  const px = G.L < 220 ? 11 : 12;
  PRODUCT_EDGES.forEach((e, ei) => {
    const [x, y] = chipAt(G, e, fx);
    const c = cnt.edges[ei], active = step === 'edges' && c > 0 && c < e.products;
    const txt = active || (step === 'edges' && c === e.products && T < EDGE_T0 + (ei + 1) * EDGE_SPAN + 0.6)
      ? e.na + ' · ' + e.nb + ' = ' + c : String(c || (step === 'slots' ? '' : 0));
    if (!txt) return;
    const off = e.solid ? (SLOT[e.a].role === 'center' ? -14 : -14) : 0;
    chip(g, txt, x, y + off, hiX > 0 ? (e.solid ? C.x : C.y) : C.rec, c / e.products, px);
  });
  if (step === 'arc' || step === 'mirror') {
    const A = node(G, ARC.a, fx), B = node(G, ARC.b, fx);
    chip(g, cnt.arc + ' commutator' + (cnt.arc === 1 ? '' : 's'), (A[0] + B[0]) / 2, G.arcY + 12, hiX > 0 ? C.alpha : C.rec, step === 'arc' ? cnt.arc / ARC.records : 1, px);
  }

  // column labels
  if (!opts.bare) {
    const yTop = G.cy - G.L / 2 - G.R - 14;
    label(g, 'read 1', node(G, 'Q1', fx)[0], yTop, { font: font(12), color: C.dim });
    label(g, 'read 2', node(G, 'Q2', fx)[0], yTop, { font: font(12), color: C.dim });
    if (step === 'mirror') label(g, 'swap the reads', G.cx, yTop - 2, { font: font(11), color: C.glass, alpha: mirA, halo: 'rgba(7,11,14,0.9)' });
  }

  // tally line
  const total = cnt.edges.reduce((a, b) => a + b, 0);
  const yT = Math.min(env.view.y + env.view.h - 30, G.arcY + 46);
  let txt;
  if (step === 'slots') txt = SLOTS.map(s => s.id + ' ' + s.letters).join('  ·  ') + '  letters';
  else if (step === 'edges') txt = total + ' of ' + PRODUCT_TERMS + ' products';
  else txt = PRODUCT_TERMS + ' products + ' + cnt.arc + ' commutators = ' + (PRODUCT_TERMS + cnt.arc) + ' records';
  if (step === 'mirror' && hiX > 0) {
    label(g, 'X acts on the solid edges and the arc', G.cx, yT, { font: font(G.L < 220 ? 12 : 14, 600), color: C.x, alpha: hiX });
    label(g, 'Y acts on the dashed edges and the arc', G.cx, yT + 20, { font: font(G.L < 220 ? 12 : 14, 600), color: C.y, alpha: hiX });
    return G;
  }
  label(g, txt, G.cx, yT, { font: font(G.L < 220 ? 12 : 14, 600), color: C.rec, alpha: step === 'slots' ? appear : 1 });
  if (step !== 'mirror' && !opts.bare) {
    const legend = 'orange: qutrit copies   blue: read qubits';
    label(g, legend, G.cx, yT + 20, { font: font(11), color: C.dim });
  }
  return G;
}

export default {
  id: 'square',
  title: 'The square of slots',
  steps: STEPS,
  analogy: {
    right: 'A record needs two letters at two different slots, so counting records is counting pairs of beads on different corners: each edge holds one product per letter at one end times letter at the other.',
    breaks: 'The square is a bookkeeping picture, not space: the corners are ends of read links, an edge is a pair of slots and not a link, and the two qutrit corners are copies of one qutrit.',
  },
  height(W) { return Math.round(clamp(W * 0.98, 340, 520)); },
  init() { return {}; },
  draw(g, env, st, t) { drawSquare(g, env, st, t); },
  caption(st) {
    const q = SLOTS.filter(s => s.role === 'center'), b = SLOTS.filter(s => s.role === 'far');
    if (st.step === 'slots') return `Four slots: the qutrit copies ${q.map(s => s.id).join(' and ')} with ${q[0].letters} letters each, the read qubits ${b.map(s => s.id).join(' and ')} with ${b[0].letters} each.`;
    if (st.step === 'edges') return `Six edges: ${PRODUCT_EDGES.map(e => e.na + '·' + e.nb).join(' + ')} = ${PRODUCT_TERMS} products, one letter at each of two different slots.`;
    if (st.step === 'arc') return `The arc: at a qubit two reads in different bases anticommute, so each of the ${ARC.records} pairs of qubit letters gives a commutator record. ${PRODUCT_TERMS} + ${ARC.records} = ${RECORDS.length}.`;
    return 'Turn the square over in the mirror of the swap of the reads: the solid edges land on themselves, where X acts; the dashed edges land on each other, where Y acts. The arc is moved by both.';
  },
};
