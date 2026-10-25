// ============================================================================
//  ALPHA QUDITS  ·  records/scenes/mirror.js  ·  X and Y as mirror flips
// ----------------------------------------------------------------------------
//  One term t (two letters at two slots, drawn on the square of slots as a
//  record glyph) and its mirror image Et under the swap E of the two reads.
//  The image is drawn by turning a copy of t over the mirror. Then the two
//  combinations of the model, the even record t + Et and the odd record
//  t − Et, each go through the exchange that acts on them (X when both
//  letters sit at ends of one kind, Y when one sits at a copy and one at a
//  qubit). A record survives when the exchange returns it times its own
//  sign; it then reads −1 and gains the dimension of the end where that
//  exchange acts (3 for X at the qutrit, 2 for Y at the qubit). The verdicts
//  and weights are read from the model records (X, Y, fx, fy, k), not set
//  here. The commutator step shows the order sign: [a, b] = −[b, a].
//
//  grep -n targets:  const STEPS | function pick | function single |
//  function panel | function draw | caption
// ============================================================================
import { samples, oddPartner, termText, letterOf, wText, SLOT } from '../data.js';
import { C, font, label, ease, clamp, lerp, drawGlyph, SECTOR_COLOR, rrect } from '../draw.js';

const STEPS = [
  { id: 'self', label: 'Own image', dur: 10 },
  { id: 'pair', label: 'Same end', dur: 11 },
  { id: 'mixed', label: 'Two ends', dur: 11 },
  { id: 'commutator', label: 'Commutator', dur: 11 },
];

function pick(st) {
  const list = samples(st.step);
  if (!list.length) return null;
  const n = ((st.pick || 0) + (st.auto ? (st.cycle || 0) * 5 : 0)) % list.length;
  // spread the examples over the list, not only the first letters
  return list[(n * 7 + 3) % list.length];
}
// A one-term pseudo record that drawGlyph can draw.
const single = (term, sector) => ({ kind: 'product', combo: 'self', sector, terms: [term] });

function geom(env) {
  const v = env.view;
  const top = v.y + 22;
  const s = clamp(Math.min(v.w * 0.36, v.h * 0.34), 94, 190);
  const ps = clamp(Math.min(v.w * 0.3, v.h * 0.27), 80, 150);
  return { v, cx: v.x + v.w / 2, s, ps, yTop: top + s / 2 + 4, yPan: top + s + 58 + ps / 2, gap: Math.max(s * 0.62, Math.min(v.w * 0.25, s * 0.95)) };
}

function verdict(rec, ex) {
  const reads = rec[ex];
  const f = ex === 'X' ? rec.fx : rec.fy;
  return { survives: reads === -1, reads, f, at: ex === 'X' ? 'the qutrit' : 'the qubit' };
}

// One panel: a record, the exchange flip, the verdict.
function panel(g, G, rec, x, title, ex, T, t0, opts = {}) {
  const ps = G.ps, y = G.yPan;
  const appear = ease(T, t0, t0 + 0.8);
  if (appear <= 0) return;
  const u = ease(T, t0 + 1.4, t0 + 3.0);
  const flip = Math.cos(Math.PI * u);
  const v = verdict(rec, ex);
  const col = SECTOR_COLOR[rec.sector];
  g.save(); g.globalAlpha = appear;
  rrect(g, x - ps * 0.82, y - ps / 2 - 30, ps * 1.64, ps + 100, 12);
  g.fillStyle = 'rgba(255,255,255,0.03)'; g.fill();
  g.strokeStyle = u >= 1 && v.survives ? col : C.line; g.lineWidth = u >= 1 && v.survives ? 1.5 : 1; g.stroke();
  label(g, title, x, y - ps / 2 - 15, { font: font(13, 600), color: C.text });
  drawGlyph(g, rec, x, y, ps, { flip, hi: u >= 1 && v.survives ? 0.6 + 0.4 * Math.sin(T * 3) * 0.5 : 0, tint: true });
  const lines = [];
  if (u > 0 && u < 1) lines.push([ex + ' acting', C.dim]);
  if (u >= 1) {
    const back = v.survives ? (rec.ownSign === -1 ? '−1' : '+1') : (rec.ownSign === -1 ? '+1' : '−1');
    lines.push([opts.order || ex + ' returns ' + back + ' × it', C.text]);
    lines.push([v.survives ? 'survives' : 'does not survive', v.survives ? col : C.dim]);
    lines.push([ex + ' reads ' + (v.survives ? '−1' : '+1'), C.dim]);
    lines.push(['k = ' + rec.k + ' · weight ' + wText(rec.k), col]);
  }
  const fp = ps < 100 ? 11 : 12;
  lines.forEach(([s, c], i) => label(g, s, x, y + ps / 2 + 13 + i * (fp + 4), { font: font(fp, i === 1 ? 600 : 500), color: c }));
  g.restore();
}

function draw(g, env, st) {
  const G = geom(env), T = st.stepT, rec = pick(st);
  if (!rec) return;
  const isComm = rec.kind === 'commutator';
  const t = isComm ? { slots: [rec.slots[0]], letters: [rec.result] } : { slots: rec.slots, letters: rec.letters };
  const img = isComm ? { slots: [rec.slots[1]], letters: [rec.result] } : (rec.image || t);
  const xl = G.cx - G.gap, xr = G.cx + G.gap;

  // mirror
  const mA = ease(T, 0, 0.6);
  g.save();
  const gl = g.createLinearGradient(G.cx - 9, 0, G.cx + 9, 0);
  gl.addColorStop(0, 'rgba(191,230,255,0)'); gl.addColorStop(0.5, `rgba(191,230,255,${0.2 * mA})`); gl.addColorStop(1, 'rgba(191,230,255,0)');
  g.fillStyle = gl; g.fillRect(G.cx - 9, G.yTop - G.s / 2 - 6, 18, G.s + 12);
  g.strokeStyle = C.glass; g.globalAlpha = 0.7 * mA; g.lineWidth = 1.2;
  g.beginPath(); g.moveTo(G.cx, G.yTop - G.s / 2 - 6); g.lineTo(G.cx, G.yTop + G.s / 2 + 6); g.stroke();
  g.restore();
  label(g, 'E: swap the reads', G.cx, G.v.y + 10, { font: font(12), color: C.glass, alpha: mA });

  // t, then a copy turning over the mirror into Et
  const sec = rec.sector;
  const aT = ease(T, 0.2, 1.2);
  g.save(); g.globalAlpha = aT;
  drawGlyph(g, single(t, sec), xl, G.yTop, G.s, { tint: false });
  g.restore();
  label(g, 't', xl - G.s * 0.5 + 6, G.yTop - G.s * 0.5 + 8, { font: font(15, 500, true), color: C.text, alpha: aT, align: 'left' });
  const u = ease(T, 1.4, 3.4);
  if (u > 0) {
    const x = lerp(xl, xr, u);
    const flip = Math.cos(Math.PI * u);
    g.save(); g.globalAlpha = 0.35 + 0.65 * u;
    drawGlyph(g, single(u >= 1 ? img : t, sec), x, G.yTop, G.s, { tint: false, flip: u >= 1 ? 1 : flip });
    g.restore();
  }
  if (u >= 1) label(g, 'Et', xr + G.s * 0.5 - 6, G.yTop - G.s * 0.5 + 8, { font: font(15, 500, true), color: C.text, align: 'right' });
  // names
  const nm = tt => isComm ? '[' + rec.letters.map(l => letterOf(rec.slots[0], l).name).join(', ') + '] at ' + tt.slots[0] : termText(tt);
  label(g, nm(t), xl, G.yTop + G.s / 2 + 14, { font: font(12), color: C.dim, alpha: aT });
  if (u >= 1) {
    const same = rec.combo === 'self';
    label(g, same ? 'the same term' : nm(img), xr, G.yTop + G.s / 2 + 14, { font: font(12, same ? 600 : 500), color: same ? SECTOR_COLOR[sec] : C.dim });
  }

  // combinations: two panels side by side (smaller on a narrow canvas)
  const t0 = 3.8;
  const G2 = { ...G, ps: Math.min(G.ps, (G.v.w - 20) / 3.42) };
  const pw = G2.ps * 1.64 + 8;
  const xa = G.cx - pw / 2 - 2, xb = G.cx + pw / 2 + 2;
  if (rec.combo === 'self') {
    panel(g, G, rec, G.cx, 'its own image', 'X', T, t0);
  } else if (isComm) {
    const L = rec.letters.map(l => letterOf(rec.slots[0], l).name);
    const narrow = G2.ps < 100;
    panel(g, G2, rec, xa, narrow ? 'X: reorder' : 'X reorders the reads', 'X', T, t0, { order: '[' + L[1] + ', ' + L[0] + '] = −[' + L[0] + ', ' + L[1] + ']' });
    panel(g, G2, rec, xb, narrow ? 'Y: q1 to q2' : 'Y moves q1 to q2', 'Y', T, t0 + 0.6, { order: 'Y returns −1 × it' });
  } else {
    const odd = oddPartner(rec);
    const ex = rec.sameEnd ? 'X' : 'Y';
    panel(g, G2, rec, xa, 'even  t + Et', ex, T, t0);
    if (odd) panel(g, G2, odd, xb, 'odd  t − Et', ex, T, t0 + 0.4);
  }
}

export default {
  id: 'mirror',
  title: 'The two exchanges as mirror flips',
  steps: STEPS,
  analogy: {
    right: 'Both exchanges act on a record the way a mirror acts on a drawing: they swap the two reads’ slots. A drawing and its mirror image either coincide or pair up, and each pair gives one even and one odd combination. The even one comes back unchanged and survives.',
    breaks: 'A real mirror reverses handedness; here nothing is reversed, the letters just change slots. And the mirror cannot say which exchange acts or what a survivor weighs: that the swap is X on same-end records and Y on the others, and that X counts 3 and Y counts 2, are clauses of the paper’s definitions.',
  },
  height(W) { return Math.round(clamp(W * 1.2, 420, 600)); },
  init(p) { return { pick: p.pick || 0 }; },
  controls(st) {
    return [
      { key: 'step', label: 'Record kind', options: STEPS.map(s => ({ v: s.id, label: s.label })) },
      { key: 'pick', label: 'Example', action: true, options: [{ v: 'next', label: 'Another record' }] },
    ];
  },
  onAction(st, v, t) { if (v === 'next') { st.pick = (st.pick || 0) + 1; st.auto = false; st.stepSince = t; } },
  draw,
  caption(st) {
    const r = pick(st);
    if (!r) return '';
    if (r.kind === 'commutator') return `Record ${r.id}: the commutator at q1 minus the same at q2. Its own sign is the order sign −1. X and Y both return it times −1, so it survives both: k = ${r.fx} · ${r.fy} = ${r.k}.`;
    if (r.combo === 'self') return `Record ${r.id}: ${termText(r)} is its own mirror image, so X returns it unchanged. It survives X, at the qutrit end: k = ${r.k}, weight ${wText(r.k)}.`;
    const o = oddPartner(r);
    const ex = r.sameEnd ? 'X' : 'Y', f = ex === 'X' ? r.fx : r.fy;
    return `Records ${r.id} and ${o ? o.id : '?'}: ${termText(r)} and its image. ${ex} acts (${r.sameEnd ? 'both letters at ends of one kind' : 'one letter at a copy, one at a qubit'}). The even sum survives with the factor ${f} (k = ${r.k}); the odd difference reads +1 (k = ${o ? o.k : 1}).`;
  },
};
