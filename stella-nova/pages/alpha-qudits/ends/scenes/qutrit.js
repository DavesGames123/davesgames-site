// ============================================================================
//  ALPHA QUDITS  ·  ends/scenes/qutrit.js  ·  analogy 2c: the qutrit end
// ----------------------------------------------------------------------------
//  step 'bases'    the 4 mutually unbiased bases of a qutrit. Each basis
//                  vector is 3 phasor dials (one per direction): length
//                  |c|, hand at the phase, a cube root of unity. A probe
//                  vector moves; the figure prints its overlap |<e|f>|^2
//                  with every vector of the other bases (computed: 1/3).
//  step 'letters'  the 8 Gell-Mann letters as 3 x 3 tiles, 5 symmetric and
//                  3 antisymmetric; the read letters P - 1/3 of the 4 bases
//                  span the same 8 dimensions (rank computed).
//  step 'phase'    the clock-shift phase: Z X = lambda X Z with lambda read
//                  from the matrices. An order sign needs lambda = 1/lambda.
//                  At d = 2, lambda = -1 works; at d = 3, lambda = omega and
//                  1/omega = omega^2 differ, so no two qutrit reads
//                  anticommute and no commutator record forms there.
//
//  GREP MAP   (grep -n "<anchor>" qutrit.js)
//    function dial ....... one phasor dial
//    function drawBases .. step 'bases'
//    function drawLetters  step 'letters'
//    function drawPhase .. step 'phase'
// ============================================================================
import { C, font, label, setBounds, arrow, clamp, rgba, ease, tile, short, rrect, arcArrow } from '../draw.js';
import { mubs, inner, gellMann, readLetters, spanRank, weylPhase, signPossible } from '../linalg.js';

const STEPS = [{ id: 'bases', label: 'Four bases' }, { id: 'letters', label: 'Eight letters' }, { id: 'phase', label: 'No sign' }];
const PERIOD = 11;
const MB = mubs(3);
const BCOL = [C.qutrit, C.read, C.imag, C.unbr];
const GM = gellMann();
const RL3 = readLetters(3), RK_READ = spanRank(RL3.map(l => l.A)), RK_BOTH = spanRank(RL3.map(l => l.A).concat(GM));

function dial(g, x, y, r, re, im, col, alpha = 1) {
  const m = Math.hypot(re, im);
  g.save(); g.globalAlpha *= alpha;
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.strokeStyle = 'rgba(255,255,255,0.14)'; g.lineWidth = 1; g.stroke();
  if (m > 1e-9) {
    const L = r * Math.min(1, m * Math.sqrt(3)) * 0.92, ang = -Math.atan2(im, re);
    g.strokeStyle = col; g.lineWidth = 2.4; g.lineCap = 'round';
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(ang) * L, y + Math.sin(ang) * L); g.stroke();
    g.beginPath(); g.arc(x + Math.cos(ang) * L, y + Math.sin(ang) * L, 2.4, 0, Math.PI * 2); g.fillStyle = col; g.fill();
  } else { g.beginPath(); g.arc(x, y, 1.6, 0, Math.PI * 2); g.fillStyle = 'rgba(255,255,255,0.3)'; g.fill(); }
  g.restore();
}

function drawBases(g, v, st, tt) {
  const cols = v.w < 560 ? 2 : 4, pad = 8, cw = (v.w - pad * 2) / cols;
  const r = clamp(cw / 10.5, 9, 19), rowH = r * 2 + 18, cardH = 3 * rowH + 30;
  const probe = Math.floor(Math.max(0, tt) / 2.4) % 12, pb = Math.floor(probe / 3), pj = probe % 3, f = MB[pb].vecs[pj];
  label(g, 'three dials per vector: length |c|, hand at the phase', v.x + v.w / 2, v.y + 12, { font: font(12), color: C.dim });
  MB.forEach((B, b) => {
    const col = b % cols, row = Math.floor(b / cols), cx = v.x + pad + cw * (col + 0.5) - 16, y0 = v.y + 54 + row * cardH;
    label(g, b === 0 ? 'standard basis' : 'basis of ' + B.name, cx + 16, y0 - 18, { font: font(13, 600), color: BCOL[b] });
    B.vecs.forEach((e, j) => {
      const y = y0 + j * rowH + r, me = b === pb && j === pj;
      const [re, im] = inner(e, f), ov = re * re + im * im;
      if (me) { rrect(g, cx - 3 * r - 10, y - r - 6, 6 * r + 20, r * 2 + 12, 8); g.fillStyle = rgba(BCOL[b], 0.16); g.fill(); g.strokeStyle = rgba(BCOL[b], 0.8); g.lineWidth = 1.2; g.stroke(); }
      for (let n = 0; n < 3; n++) dial(g, cx + (n - 1) * (r * 2 + 4), y, r, e.re[n], e.im[n], BCOL[b], me || b !== pb ? 1 : 0.45);
      if (b !== pb) label(g, ov.toFixed(3), cx + 3 * r + 6, y, { font: font(11, 500), color: C.dim, align: 'left' });
    });
  });
  let mn = 1, mx = 0;
  MB.forEach((B, b) => { if (b !== pb) B.vecs.forEach(e => { const [re, im] = inner(e, f), o = re * re + im * im; mn = Math.min(mn, o); mx = Math.max(mx, o); }); });
  const yb = Math.min(v.y + 54 + Math.ceil(4 / cols) * cardH - 4, v.y + v.h - 46);
  label(g, 'lit vector against the 9 vectors of the other bases:', v.x + v.w / 2, yb, { font: font(12), color: C.dim });
  label(g, `|⟨e|f⟩|² from ${mn.toFixed(3)} to ${mx.toFixed(3)}: one third each`, v.x + v.w / 2, yb + 19, { font: font(12.5, 600), color: C.text });
  label(g, 'every phase is 1, ω or ω², with ω = e^(2πi/3)', v.x + v.w / 2, yb + 38, { font: font(12), color: C.accent });
}

function drawLetters(g, v, st, tt) {
  const wide = v.w >= 640, perRow = wide ? 8 : 4, gap = wide ? 14 : 10;
  const s = clamp(Math.min((v.w - 24 - gap * (perRow - 1)) / (perRow * 3), (v.h * 0.45) / (wide ? 4.2 : 7.6)), 12, 30);
  const tw = 3 * s, rowW = perRow * tw + (perRow - 1) * gap, x0 = v.x + (v.w - rowW) / 2, y0 = v.y + 38;
  const lit = Math.floor(Math.max(0, tt) / 1.1) % 8;
  label(g, 'the 8 letters of a qutrit end, λ1 to λ8 (Gell-Mann)', v.x + v.w / 2, v.y + 12, { font: font(12), color: C.dim });
  GM.forEach((M, k) => {
    const row = Math.floor(k / perRow), col = k % perRow, x = x0 + col * (tw + gap), y = y0 + row * (tw + 30);
    const appear = ease((tt - k * 0.12) / 0.5), on = k === lit;
    g.save(); g.globalAlpha = Math.max(0.15, appear) * (on ? 1 : 0.72);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      const re = M.re[i * 3 + j], im = M.im[i * 3 + j];
      tile(g, x + j * s, y + i * s, s, re, im, 1.16, { text: im ? (im > 0 ? 'i' : '−i') : (Math.abs(Math.abs(re) - 1) < 1e-9 ? short(re, 1) : (re > 0 ? '+' : '−')), stroke: on ? 'rgba(255,255,255,0.45)' : null });
    }
    label(g, M.name, x + tw / 2, y + tw + 11, { font: font(13, on ? 700 : 500, true, true), color: M.kind === 'sym' ? C.qubit : C.accent });
    g.restore();
  });
  const rows = wide ? 1 : 2;
  let yb = y0 + rows * (tw + 30) + 4;
  const nSym = GM.filter(m => m.kind === 'sym').length, nAnti = GM.length - nSym;
  const RL = RL3, rkRead = RK_READ, rkBoth = RK_BOTH;
  label(g, `${nSym} symmetric (blue names), ${nAnti} antisymmetric (yellow)`, v.x + v.w / 2, yb + 6, { font: font(12.5, 500), color: C.text });
  // one basis at a time: its three read letters P_j - 1/3, which sum to zero
  const b = Math.floor(Math.max(0, tt) / 2.6) % 4, ls = RL.filter(l => l.basis === b);
  const s2 = clamp(Math.min((v.w - 60) / 12, 26), 14, 26), tw2 = 3 * s2, gap2 = Math.max(16, s2 * 0.9);
  const totalW = 3 * tw2 + 2 * gap2, x2 = v.x + (v.w - totalW) / 2, y2 = yb + 40;
  label(g, `the read letters of ${b === 0 ? 'the standard basis' : 'basis ' + MB[b].name}: Pⱼ − 1/3`, v.x + v.w / 2, y2 - 14, { font: font(12), color: BCOL[b] });
  ls.forEach((l, j) => {
    const x = x2 + j * (tw2 + gap2);
    for (let i = 0; i < 3; i++) for (let k = 0; k < 3; k++) tile(g, x + k * s2, y2 + i * s2, s2, l.A.re[i * 3 + k], l.A.im[i * 3 + k], 0.67);
    if (j < 2) label(g, '+', x + tw2 + gap2 / 2, y2 + tw2 / 2, { font: font(16), color: C.dim });
  });
  label(g, '= 0, so each basis adds d − 1 = 2 new letters', v.x + v.w / 2, y2 + tw2 + 14, { font: font(12), color: C.dim });
  label(g, `4 bases × 2 = ${rkRead} independent read letters`, v.x + v.w / 2, y2 + tw2 + 36, { font: font(12.5, 600), color: C.text });
  label(g, `adding λ1 to λ8 keeps the span at ${rkBoth}`, v.x + v.w / 2, y2 + tw2 + 56, { font: font(12), color: C.dim });
}

function drawPhase(g, v, st, tt) {
  const wide = v.w >= 560, r = clamp(Math.min(wide ? v.w * 0.14 : v.w * 0.2, v.h * (wide ? 0.25 : 0.14)), 44, 105);
  const cy1 = v.y + r + 44, centres = wide ? [[v.x + v.w * 0.27, v.y + v.h * 0.4], [v.x + v.w * 0.73, v.y + v.h * 0.4]] : [[v.x + v.w / 2, cy1], [v.x + v.w / 2, cy1 + 2 * r + 116]];
  const ph = (Math.max(0, tt) % 5) / 5, k = ease(ph / 0.55);
  [2, 3].forEach((d, idx) => {
    const [cx, cy] = centres[idx], [lr, li] = weylPhase(d), col = d === 2 ? C.qubit : C.qutrit;
    const lam = Math.abs(li) < 1e-9 ? (lr < 0 ? Math.PI : 0) : Math.atan2(li, lr);
    label(g, d === 2 ? 'qubit, d = 2' : 'qutrit, d = 3', cx, cy - r - 30, { font: font(14, 600), color: col });
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.strokeStyle = 'rgba(255,255,255,0.22)'; g.lineWidth = 1.2; g.stroke();
    g.beginPath(); g.moveTo(cx - r - 8, cy); g.lineTo(cx + r + 8, cy); g.moveTo(cx, cy - r - 8); g.lineTo(cx, cy + r + 8); g.strokeStyle = 'rgba(255,255,255,0.08)'; g.stroke();
    // the two orders: one way x lambda (yellow, counter-clockwise), the other x 1/lambda (violet, clockwise)
    const a1 = k * lam, a2 = -k * lam;
    for (const [aa, c2, rr] of [[a1, C.accent, r * 1.0], [a2, C.imag, r * 0.86]]) {
      if (Math.abs(aa) > 0.02) arcArrow(g, cx, cy, rr, 0, -aa, { color: c2, w: 3, head: 9 });
      g.save(); g.strokeStyle = c2; g.lineWidth = 2; g.globalAlpha = 0.85;
      g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + rr * Math.cos(aa), cy - rr * Math.sin(aa)); g.stroke(); g.restore();
    }
    for (const p of signPossible(d)) {
      const x = cx + r * p.re, y = cy - r * p.im;
      g.beginPath(); g.arc(x, y, 5.5, 0, Math.PI * 2); g.fillStyle = col; g.fill();
      const nm = p.k === 0 ? '1' : d === 2 ? '−1' : p.k === 1 ? 'ω' : 'ω²';
      label(g, nm, cx + (r + 24) * p.re, cy - (r + 20) * p.im, { font: font(14, 500, true, true), color: C.text });
    }
    const same = Math.abs(Math.sin(lam)) < 1e-9;
    if (k > 0.98) {
      const x = cx + r * Math.cos(lam), y = cy - r * Math.sin(lam);
      g.beginPath(); g.arc(x, y, 11, 0, Math.PI * 2); g.strokeStyle = same ? C.ok : C.dark; g.lineWidth = 2; g.stroke();
      if (!same) { const x2 = cx + r * Math.cos(-lam), y2 = cy - r * Math.sin(-lam); g.beginPath(); g.arc(x2, y2, 11, 0, Math.PI * 2); g.stroke(); }
    }
    const ty = cy + r + 26;
    label(g, `Z X = ${Math.abs(li) < 5e-3 ? lr.toFixed(2).replace('-', '−') : '(' + lr.toFixed(2).replace('-', '−') + (li >= 0 ? ' + ' : ' − ') + Math.abs(li).toFixed(2) + 'i)'} · X Z, from the matrices`, cx, ty, { font: font(12), color: C.dim });
    label(g, same ? 'λ = 1/λ = −1: a sign, and a record forms' : 'λ = ω but 1/λ = ω²: no sign, no record', cx, ty + 20, { font: font(12.5, 600), color: same ? C.ok : C.dark });
  });
  const yb = wide ? v.y + v.h - 40 : centres[1][1] + r + 74;
  if (yb < v.y + v.h - 4) {
    label(g, 'yellow: one order, ×λ. violet: the other, ×1/λ', v.x + v.w / 2, yb, { font: font(12), color: C.dim });
    if (yb + 20 < v.y + v.h) label(g, 'odd d: AB = −BA forces det(AB) = −det(BA), impossible', v.x + v.w / 2, yb + 20, { font: font(12), color: C.text });
  }
}

export default {
  id: 'qutrit',
  title: 'The qutrit end: letters and phases',
  steps: STEPS,
  autoKey: 'step',
  analogy: {
    right: 'A qutrit has one more read basis than a qubit and two letters per basis, so its alphabet is the 8 Gell-Mann letters. Its phases go round in thirds, like a three-position switch, where a qubit flips between plus and minus.',
    breaks: 'There is no sphere for a qutrit: its states fill an 8-dimensional shape that no 3D picture shows faithfully, so the figure draws dials and tiles instead. The letters are a basis choice; the counts do not depend on it, the drawings do.',
  },
  height: W => Math.round(W < 560 ? clamp(W * 1.62, 540, 660) : clamp(W * 0.58, 400, 500)),
  init(p) { return { step: p.step || 'bases' }; },
  controls() { return [{ key: 'step', label: 'Step', options: STEPS.map(s => ({ v: s.id, label: s.label })) }]; },
  caption(st) {
    if (st.step === 'bases') return 'Four read bases at a qutrit, d + 1 = 4. Every vector of one basis overlaps every vector of another with weight 1/3, computed here for the lit vector.';
    if (st.step === 'letters') return 'Each basis gives d − 1 = 2 traceless letters, so 4 × 2 = 8 in all: the Gell-Mann matrices. Five are real and symmetric, three are imaginary and antisymmetric.';
    return 'Exchanging two reads twice must be no exchange, so the phase between their two orders must be a sign. The qubit phase is −1; the qutrit phase is a cube root of unity, which is not its own inverse.';
  },
  draw(g, env, st, t) {
    setBounds(env.view);
    const tt = t - st.since;
    if (st.auto) st.step = STEPS[Math.floor(Math.max(0, tt) / PERIOD) % STEPS.length].id;
    const local = st.auto ? Math.max(0, tt) % PERIOD : tt;
    if (st.step === 'bases') drawBases(g, env.view, st, local);
    else if (st.step === 'letters') drawLetters(g, env.view, st, local);
    else drawPhase(g, env.view, st, local);
  },
};
