// ============================================================================
//  ALPHA QUDITS  ·  records/scenes/abacus.js  ·  adding the weights (Eq. 6)
// ----------------------------------------------------------------------------
//  An abacus with one wire group per sector. The records arrive one by one
//  in the model's record order; each drops a bead on the wire of its sector
//  and slides it home. The bead's area follows its weight 1, √2, √3 or √6.
//  The running exact sum a + b√2 + c√3 + d√6 and its decimal value tick
//  with the beads. Then the sum is divided by the readout dimension N (its
//  three factors from MODEL) and the digits of 1/alpha_cand lock in one by
//  one, exact digits from MODEL's integer square roots. The last step
//  compares the weight law with the two alternatives of Table S5 that change
//  the weights (Born k, no weights), recomputed by MODEL.
//
//  The comparison with experiment says Conjecture 1: the identification of
//  this number with alpha(0) is the paper's conjecture.
//
//  grep -n targets:  const STEPS | function geom | function beads |
//  function drawDigits | function drawWeights | caption
// ============================================================================
import { RECORDS, SECTOR_ROWS, READOUT, VALUE, ALT, SIGMA, TOTAL, runningSum, oneMore, wText, MEASUREMENTS } from '../data.js';
import { C, font, fontRaw, label, ease, clamp, lerp, rrect, SECTOR_COLOR } from '../draw.js';

const STEPS = [
  { id: 'count', label: 'Count', dur: 15 },
  { id: 'divide', label: 'Divide by N', dur: 13 },
  { id: 'weights', label: 'Other weights', dur: 11 },
];
const PER_WIRE = 10;
const STREAM = 10.5;                       // seconds for all beads
const beadT = n => 0.6 + STREAM * n / RECORDS.length;
const radius = (k, base) => base * Math.pow(k, 0.25);

// For each record: its sector row and its place among that sector's beads.
const PLACE = (() => {
  const seen = {};
  return RECORDS.map(r => { const n = seen[r.sector] = (seen[r.sector] || 0) + 1; return { sector: r.sector, k: r.k, n: n - 1 }; });
})();

function geom(env) {
  const v = env.view, narrow = v.w < 460;
  const base = narrow ? 5 : 6;
  const lw = narrow ? 58 : 84, x0 = v.x + lw + 10, x1 = v.x + v.w - 12;
  let y = v.y + 34;
  const groups = SECTOR_ROWS.map(s => {
    const r = radius(s.k, base), wires = Math.ceil(s.count / PER_WIRE), dy = 2 * r + 5;
    const gr = { ...s, r, wires, dy, y0: y + r + 2 };
    y += wires * dy + 10;
    return gr;
  });
  return { v, narrow, base, lw, x0, x1, groups, yRes: y + 6 };
}
function beadXY(G, gr, n) {
  const w = Math.floor(n / PER_WIRE), c = n % PER_WIRE;
  const pitch = 2 * gr.r + 3;
  return [G.x0 + gr.r + 2 + c * pitch, gr.y0 + w * gr.dy];
}

function beads(g, G, T, full, t) {
  // wires and frames
  for (const gr of G.groups) {
    const col = SECTOR_COLOR[gr.key];
    for (let w = 0; w < gr.wires; w++) {
      const y = gr.y0 + w * gr.dy;
      g.strokeStyle = 'rgba(200,220,230,0.2)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(G.x0 - 4, y); g.lineTo(G.x1, y); g.stroke();
    }
    g.save(); g.strokeStyle = col; g.globalAlpha = 0.5; g.lineWidth = 2;
    g.beginPath(); g.moveTo(G.x0 - 6, gr.y0 - gr.r - 2); g.lineTo(G.x0 - 6, gr.y0 + (gr.wires - 1) * gr.dy + gr.r + 2); g.stroke();
    g.restore();
    const yc = gr.y0 + (gr.wires - 1) * gr.dy / 2;
    label(g, wText(gr.k), G.v.x + G.lw - 4, yc - 7, { font: font(G.narrow ? 16 : 19, 500, true), color: col, align: 'right' });
    label(g, gr.label, G.v.x + G.lw - 4, yc + 10, { font: font(11), color: C.dim, align: 'right' });
  }
  // beads
  let current = -1;
  RECORDS.forEach((r, i) => {
    const pl = PLACE[i], gr = G.groups.find(x => x.key === pl.sector);
    const ta = full ? -1 : beadT(i);
    const u = full ? 1 : ease(T, ta, ta + 0.55);
    if (u <= 0) return;
    if (!full && T >= ta && T < ta + 0.55) current = i;
    const [hx, hy] = beadXY(G, gr, pl.n);
    const x = lerp(G.x1 - gr.r, hx, u), y = hy - Math.sin(Math.PI * u) * 0;
    const col = SECTOR_COLOR[pl.sector];
    const glow = full ? 0.15 * (1 + Math.sin(t * 2 - i * 0.2)) : 0;
    g.save();
    const grd = g.createRadialGradient ? g.createRadialGradient(x - gr.r * 0.35, y - gr.r * 0.4, gr.r * 0.1, x, y, gr.r) : null;
    if (grd) { grd.addColorStop(0, '#ffffff'); grd.addColorStop(0.25, col); grd.addColorStop(1, 'rgba(20,30,30,1)'); g.fillStyle = grd; } else g.fillStyle = col;
    g.globalAlpha = 0.5 + 0.5 * u;
    g.beginPath(); g.ellipse ? g.ellipse(x, y, gr.r * 1.1, gr.r, 0, 0, 7) : g.arc(x, y, gr.r, 0, 7); g.fill();
    if (glow) { g.globalAlpha = glow; g.fillStyle = col; g.beginPath(); g.arc(x, y, gr.r * 1.6, 0, 7); g.fill(); }
    g.restore();
  });
  return current;
}

function sumParts(counts) {
  return SECTOR_ROWS.map(s => ({ k: s.k, n: counts[s.k] || 0, col: SECTOR_COLOR[s.key] }));
}
function drawSum(g, G, counts, sum, y, alpha = 1) {
  const parts = sumParts(counts), fs = G.narrow ? 15 : 19;
  // measure and centre: "79 + 48√2 + 42√3 + 3√6"
  g.save(); g.font = fontRaw(fs, 500, true);
  const toks = [];
  parts.forEach((p, i) => { if (i) toks.push([' + ', C.dim]); toks.push([String(p.n) + (p.k === 1 ? '' : wText(p.k)), p.col]); });
  const wsum = toks.reduce((s, [t]) => s + g.measureText(t).width, 0);
  let x = G.v.x + G.v.w / 2 - wsum / 2;
  g.globalAlpha = alpha; g.textBaseline = 'middle';
  for (const [t, c] of toks) { g.fillStyle = c; g.fillText(t, x, y); x += g.measureText(t).width; }
  g.restore();
  label(g, '= ' + sum.toFixed(6) + '…', G.v.x + G.v.w / 2, y + fs + 6, { font: font(G.narrow ? 13 : 15, 500, true), color: C.text, alpha });
}

function drawDigits(g, G, T, y) {
  const nd = G.narrow ? 21 : 30;
  const str = VALUE.inverseDigits(nd);           // '137.0359…' exact
  const [ip, fp] = str.split('.');
  const shown = clamp(Math.floor((T - 4.0) / 0.16), 0, nd);
  const fs = G.narrow ? 15 : 19;
  g.save(); g.font = fontRaw(fs, 500, true); g.textBaseline = 'middle';
  const dw = g.measureText('0').width + 0.5, gap = dw * 0.5;
  const total = g.measureText(ip + '.').width + nd * dw + Math.floor((nd - 1) / 3) * gap;
  let x = G.v.x + G.v.w / 2 - total / 2;
  const x0 = x;
  g.fillStyle = C.alpha; g.globalAlpha = ease(T, 3.4, 4.0);
  g.fillText(ip + '.', x, y); x += g.measureText(ip + '.').width;
  const xd = [];
  for (let k = 0; k < nd; k++) {
    if (k && k % 3 === 0) x += gap;
    xd.push(x);
    if (k < shown) { g.globalAlpha = 1; g.fillStyle = C.alpha; g.fillText(fp[k], x, y); }
    else if (k === shown && T > 4.0) { g.globalAlpha = 0.5; g.fillStyle = C.dim; g.fillText(String(Math.floor(T * 37 + k) % 10), x, y); }
    x += dw;
  }
  g.restore();
  // CODATA 2022 under the digits, aligned, while it is shown
  const cod = MEASUREMENTS.find(m => m.id === 'codata2022');
  const cd = cod.value.split('.')[1];
  const a = ease(T, 4.0 + 0.16 * cd.length, 4.6 + 0.16 * cd.length);
  if (a > 0) {
    g.save(); g.font = fontRaw(G.narrow ? 13 : 15, 500, true); g.textBaseline = 'middle'; g.globalAlpha = a; g.fillStyle = C.dim;
    g.fillText(cod.value.split('.')[0] + '.', x0, y + fs + 8);
    for (let k = 0; k < cd.length; k++) {
      const same = cd[k] === fp[k] && cd.slice(0, k) === fp.slice(0, k);
      g.fillStyle = same ? C.text : C.dim; g.fillText(cd[k], xd[k], y + fs + 8);
    }
    const unc = '(' + String(Number(cod.unc.split('.')[1])) + ')';
    g.fillStyle = C.dim; g.fillText(unc, xd[cd.length - 1] + dw * 1.2, y + fs + 8);
    g.restore();
    const s = SIGMA.find(q => q.id === 'codata2022');
    const off = (s.sigma >= 0 ? '+' : '−') + Math.abs(s.sigma).toFixed(1) + 'σ';
    if (G.narrow) {
      label(g, `above: our exact digits; below: CODATA 2022, ${off}`, G.v.x + G.v.w / 2, y + 2 * fs + 22, { font: font(11), color: C.dim, alpha: a });
      label(g, 'Calling it α(0) is the paper\u2019s Conjecture 1.', G.v.x + G.v.w / 2, y + 2 * fs + 38, { font: font(11), color: C.dim, alpha: a });
    } else {
      label(g, `Above: our exact digits. Below: CODATA 2022, ${off} away. Calling the candidate α(0) is the paper\u2019s Conjecture 1.`,
        G.v.x + G.v.w / 2, y + 2 * fs + 22, { font: font(12), color: C.dim, alpha: a });
    }
  }
}

function drawWeights(g, G, T, y) {
  const rows = [
    { name: 'weight √k (the paper)', v: VALUE.inverse, col: C.alpha },
    { name: 'Born weight k', v: ALT.born.inverse, col: C.dim },
    { name: 'no weights', v: ALT.noWeights.inverse, col: C.dim },
  ];
  const max = Math.max(...rows.map(r => r.v)) * 1.08;
  const x0 = G.v.x + 12, x1 = G.v.x + G.v.w - 12, bh = G.narrow ? 16 : 18;
  rows.forEach((r, i) => {
    const yy = y + i * (bh + 26);
    const u = ease(T, 0.4 + i * 0.5, 1.6 + i * 0.5);
    label(g, r.name, x0, yy, { font: font(12, 500), color: C.text, align: 'left' });
    rrect(g, x0, yy + 9, (x1 - x0) * (r.v / max) * u, bh, 4);
    g.save(); g.fillStyle = r.col; g.globalAlpha = i ? 0.45 : 0.85; g.fill(); g.restore();
    label(g, '1/α = ' + (r.v).toFixed(3), x0 + (x1 - x0) * (r.v / max) * u - 6, yy + 9 + bh / 2, { font: font(12, 600), color: '#0b1014', align: 'right', alpha: u > 0.6 ? 1 : 0 });
  });
  const mx = x0 + (x1 - x0) * (137.036 / max);
  g.save(); g.strokeStyle = C.text; g.globalAlpha = 0.5; g.setLineDash([3, 4]);
  g.beginPath(); g.moveTo(mx, y - 6); g.lineTo(mx, y + 3 * (bh + 26)); g.stroke(); g.restore();
  label(g, 'measured ≈ 137.036', mx, y + 3 * (bh + 26) + 10, { font: font(11), color: C.dim });
  const d1 = oneMore(1);
  const msg = `One more record at weight 1 would move 1/α by ${d1.toFixed(3).replace('-', '−')}.`;
  label(g, msg, G.v.x + G.v.w / 2, y + 3 * (bh + 26) + 30, { font: font(G.narrow ? 11 : 12), color: C.text, alpha: ease(T, 3.5, 4.5) });
  label(g, 'Every record counts.', G.v.x + G.v.w / 2, y + 3 * (bh + 26) + 46, { font: font(G.narrow ? 11 : 12), color: C.dim, alpha: ease(T, 3.5, 4.5) });
}

function draw(g, env, st, t) {
  const G = geom(env), T = st.stepT, step = st.step;
  const full = step !== 'count';
  const n = full ? RECORDS.length : RECORDS.filter((r, i) => T >= beadT(i) + 0.55).length;
  const rs = runningSum(n);
  // header
  label(g, full ? `${RECORDS.length} records, one bead each` : `record ${Math.min(n + 1, RECORDS.length)} of ${RECORDS.length}`, G.v.x + 12, G.v.y + 14, { font: font(12, 600), color: C.rec, align: 'left' });
  const cur = beads(g, G, T, full, t);
  if (cur >= 0) {
    const r = RECORDS[cur];
    label(g, `record ${r.id} adds ${wText(r.k)}`, G.v.x + G.v.w - 12, G.v.y + 14, { font: font(12), color: SECTOR_COLOR[r.sector], align: 'right' });
  }
  const y = G.yRes + 8;
  if (step === 'count') drawSum(g, G, rs.counts, rs.sum, y + 10);
  else if (step === 'divide') {
    const fs = G.narrow ? 15 : 19;
    drawSum(g, G, TOTAL.counts, TOTAL.sum, y + 10, 1 - ease(T, 0.4, 1.0) * 0.4);
    const a = ease(T, 1.0, 2.0);
    label(g, `÷ N = ${READOUT.unread} · ${READOUT.read.join(' · ')} = ${READOUT.N}`, G.v.x + G.v.w / 2, y + 2 * fs + 22, { font: font(G.narrow ? 13 : 15, 500, true), color: C.N, alpha: a });
    label(g, `α_cand = ${VALUE.float.toPrecision(12)}…`, G.v.x + G.v.w / 2, y + 3 * fs + 34, { font: font(G.narrow ? 13 : 15, 500, true), color: C.alpha, alpha: ease(T, 2.2, 3.0) });
    drawDigits(g, G, T, y + 4 * fs + 52);
  } else drawWeights(g, G, T, y + 6);
}

export default {
  id: 'abacus',
  title: 'The abacus of weights',
  steps: STEPS,
  analogy: {
    right: 'The value is a plain sum: one bead per record, a heavier bead for a record that survives more, and the total over the size of the readout. Nothing is fitted; move one bead and the number moves.',
    breaks: 'An abacus counts in order; the records have no order and enter all at once as directions of the readout space. The bead sizes are only a picture of the weights, which come from the weight law, not from anything the beads do.',
  },
  height(W) {
    const G = geom({ view: { x: 0, y: 0, w: W, h: 1000 } });
    return Math.round(G.yRes + (W < 460 ? 196 : 232));
  },
  init() { return {}; },
  draw,
  caption(st) {
    const parts = SECTOR_ROWS.map(s => s.count + (s.k === 1 ? '' : ' ' + wText(s.k))).join(' + ');
    if (st.step === 'count') return `Each record adds its weight: ${parts} = ${TOTAL.sum.toFixed(6)}…`;
    if (st.step === 'divide') return `Divide by the readout dimension N = ${READOUT.unread} · ${READOUT.read.join(' · ')} = ${READOUT.N}: 1/α_cand = ${VALUE.inverseDigits(15)}… (exact digits). The match with α(0) is Conjecture 1 of the paper.`;
    return `The weight law decides the number. With √k it gives ${VALUE.inverse.toFixed(3)}; with the Born square k, ${ALT.born.inverse.toFixed(3)}; with no weights, ${ALT.noWeights.inverse.toFixed(3)} (Table S5, recomputed by our model).`;
  },
};
