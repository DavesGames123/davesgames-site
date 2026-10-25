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
import { C, font, label, arrow, clamp, rgba, ease, tile, short, rrect, arcArrow } from '../draw.js';
import { mubs, inner, gellMann, readLetters, spanRank, weylPhase, signPossible } from '../linalg.js';

const STEPS = [{ id: 'bases', label: 'Four bases' }, { id: 'letters', label: 'Eight letters' }, { id: 'phase', label: 'No sign' }];
const PERIOD = 11;
const MB = mubs(3);
const BCOL = [C.qutrit, C.read, C.imag, C.unbr];
const GM = gellMann();

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
  const cols = 4, pad = 10, cw = (v.w - pad * 2) / cols;
  const r = clamp(cw / 8.2, 8, 17), rowH = r * 2 + 16, y0 = v.y + 46;
  const probe = Math.floor(Math.max(0, tt) / 2.4) % 12, pb = Math.floor(probe / 3), pj = probe % 3, f = MB[pb].vecs[pj];
  label(g, 'each vector: three dials, one per direction (length |c|, hand at the phase)', v.x + v.w / 2, v.y + 14, { font: font(12), color: C.dim });
  MB.forEach((B, b) => {
    const cx = v.x + pad + cw * (b + 0.5);
    label(g, b === 0 ? 'standard' : 'basis ' + B.name, cx, y0 - 16, { font: font(13, 600), color: BCOL[b] });
    B.vecs.forEach((e, j) => {
      const y = y0 + j * rowH + r, me = b === pb && j === pj;
      const [re, im] = inner(e, f), ov = re * re + im * im;
      if (me) { rrect(g, cx - cw / 2 + 3, y - r - 6, cw - 6, r * 2 + 12, 8); g.fillStyle = rgba(BCOL[b], 0.16); g.fill(); g.strokeStyle = rgba(BCOL[b], 0.7); g.lineWidth = 1.2; g.stroke(); }
      for (let n = 0; n < 3; n++) dial(g, cx + (n - 1) * (r * 2 + 4), y, r, e.re[n], e.im[n], BCOL[b], me || b !== pb ? 1 : 0.5);
      if (b !== pb) label(g, ov.toFixed(3), cx, y + r + 7, { font: font(11, 500), color: C.dim });
    });
  });
  const yb = y0 + 3 * rowH + 18;
  let mn = 1, mx = 0;
  MB.forEach((B, b) => { if (b !== pb) B.vecs.forEach(e => { const [re, im] = inner(e, f), o = re * re + im * im; mn = Math.min(mn, o); mx = Math.max(mx, o); }); });
  label(g, `overlaps of the lit vector with the 9 vectors of the other bases: ${mn.toFixed(3)} to ${mx.toFixed(3)}, so 1/3 each`, v.x + v.w / 2, Math.min(yb, v.y + v.h - 34), { font: font(12, 500), color: C.text });
  label(g, 'the phases are 1, ω, ω² with ω = e^{2πi/3}: cube roots of unity', v.x + v.w / 2, Math.min(yb + 20, v.y + v.h - 14), { font: font(12), color: C.accent });
}

function drawLetters(g, v, st, tt) {
  const wide = v.w >= 640, perRow = wide ? 8 : 4, gap = wide ? 14 : 10;
  const s = clamp(Math.min((v.w - 24 - gap * (perRow - 1)) / (perRow * 3), (v.h - 150) / (wide ? 4.2 : 7.6)), 12, 30);
  const tw = 3 * s, rowW = perRow * tw + (perRow - 1) * gap, x0 = v.x + (v.w - rowW) / 2, y0 = v.y + 40;
  const lit = Math.floor(Math.max(0, tt) / 1.1) % 8;
  label(g, 'the 8 letters of a qutrit end: Gell-Mann matrices λ1 to λ8', v.x + v.w / 2, v.y + 14, { font: font(12), color: C.dim });
  GM.forEach((M, k) => {
    const row = Math.floor(k / perRow), col = k % perRow, x = x0 + col * (tw + gap), y = y0 + row * (tw + 34);
    const appear = ease((tt - k * 0.12) / 0.5), on = k === lit;
    g.save(); g.globalAlpha = appear * (on ? 1 : 0.72);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      const re = M.re[i * 3 + j], im = M.im[i * 3 + j];
      tile(g, x + j * s, y + i * s, s, re, im, 1.16, { text: im ? (im > 0 ? 'i' : '−i') : (Math.abs(re) > 0.6 || re === 0 ? short(re, 1) : (re > 0 ? '•' : '−')), stroke: on ? 'rgba(255,255,255,0.4)' : null });
    }
    label(g, M.name, x + tw / 2, y + tw + 11, { font: font(13, on ? 700 : 500, true, true), color: M.kind === 'sym' ? C.qubit : C.accent });
    g.restore();
  });
  const rows = wide ? 1 : 2, yb = y0 + rows * (tw + 34) + 6;
  const nSym = GM.filter(m => m.kind === 'sym').length, nAnti = GM.length - nSym;
  const rkRead = spanRank(readLetters(3).map(l => l.A)), rkBoth = spanRank(readLetters(3).map(l => l.A).concat(GM));
  const lines = [
    [`${nSym} symmetric (real) and ${nAnti} antisymmetric (imaginary)`, C.text, 500],
    [`4 bases × (d − 1) = 4 × 2 = ${rkRead} independent read letters`, C.text, 500],
    [`together with the Gell-Mann set the span stays ${rkBoth}: the same 8 dimensions`, C.dim, 400],
    ['a qubit end has (2 + 1)(2 − 1) = 3 letters, the Pauli matrices', C.qubit, 400],
  ];
  lines.forEach(([s2, col, w], i) => label(g, s2, v.x + v.w / 2, Math.min(yb + 8 + i * 21, v.y + v.h - 10 - (lines.length - 1 - i) * 21), { font: font(12.5, w), color: col }));
}

function drawPhase(g, v, st, tt) {
  const wide = v.w >= 560, r = clamp(Math.min(wide ? v.w * 0.15 : v.w * 0.24, v.h * (wide ? 0.27 : 0.17)), 44, 110);
  const centres = wide ? [[v.x + v.w * 0.27, v.y + v.h * 0.42], [v.x + v.w * 0.73, v.y + v.h * 0.42]] : [[v.x + v.w / 2, v.y + r + 46], [v.x + v.w / 2, v.y + 3 * r + 128]];
  [2, 3].forEach((d, idx) => {
    const [cx, cy] = centres[idx], [lr, li] = weylPhase(d), lam = Math.atan2(li, lr), col = d === 2 ? C.qubit : C.qutrit;
    label(g, d === 2 ? 'qubit, d = 2' : 'qutrit, d = 3', cx, cy - r - 30, { font: font(14, 600), color: col });
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.strokeStyle = 'rgba(255,255,255,0.22)'; g.lineWidth = 1.2; g.stroke();
    g.beginPath(); g.moveTo(cx - r - 8, cy); g.lineTo(cx + r + 8, cy); g.moveTo(cx, cy - r - 8); g.lineTo(cx, cy + r + 8); g.strokeStyle = 'rgba(255,255,255,0.08)'; g.stroke();
    for (const p of signPossible(d)) {
      const x = cx + r * p.re, y = cy - r * p.im;
      g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.fillStyle = rgba(col, 0.9); g.fill();
      const nm = p.k === 0 ? '1' : d === 2 ? '−1' : p.k === 1 ? 'ω' : 'ω²';
      label(g, nm, cx + (r + 18) * p.re, cy - (r + 18) * p.im, { font: font(14, 500, true, true), color: C.text });
    }
    // animate: exchange once (x lambda), then back (x 1/lambda); the order
    // sign must be the same both ways
    const ph = (Math.max(0, tt) % 4) / 4, a1 = ease(ph / 0.35) * lam, a2 = -ease((ph - 0.45) / 0.35) * lam;
    arcArrow(g, cx, cy, r * 0.62, 0, -a1, { color: C.accent, w: 2.5 });
    if (ph > 0.45) arcArrow(g, cx, cy, r * 0.42, 0, -a2, { color: C.imag, w: 2.5 });
    const same = Math.abs(Math.sin(lam)) < 1e-9; // lambda = 1/lambda iff lambda is real
    const ty = cy + r + 26;
    label(g, `Z X = ${d === 2 ? '−1' : 'ω'} · X Z  (read from the matrices: ${lr.toFixed(2)}${li >= 0 ? ' + ' : ' − '}${Math.abs(li).toFixed(2)}i)`, cx, ty, { font: font(12), color: C.dim });
    label(g, same ? 'one order is the other times −1: a sign. A record forms.' : 'ω ≠ ω⁻¹ = ω²: no sign, no commutator record', cx, ty + 20, { font: font(12.5, 600), color: same ? C.ok : C.dark });
  });
  const yb = wide ? v.y + v.h - 24 : centres[1][1] + r + 76;
  if (yb < v.y + v.h - 4) label(g, 'in odd d, AB = −BA would give det(AB) = −det(BA), so it never happens', v.x + v.w / 2, yb, { font: font(12), color: C.text });
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
  height: W => Math.round(W < 560 ? clamp(W * 1.45, 470, 620) : clamp(W * 0.58, 380, 480)),
  init(p) { return { step: p.step || 'bases' }; },
  controls() { return [{ key: 'step', label: 'Step', options: STEPS.map(s => ({ v: s.id, label: s.label })) }]; },
  caption(st) {
    if (st.step === 'bases') return 'Four read bases at a qutrit, d + 1 = 4. Every vector of one basis overlaps every vector of another with weight 1/3, computed here for the lit vector.';
    if (st.step === 'letters') return 'Each basis gives d − 1 = 2 traceless letters, so 4 × 2 = 8 in all: the Gell-Mann matrices. Five are real and symmetric, three are imaginary and antisymmetric.';
    return 'Exchanging two reads twice must be no exchange, so the phase between their two orders must be a sign. The qubit phase is −1; the qutrit phase is a cube root of unity, which is not its own inverse.';
  },
  draw(g, env, st, t) {
    const tt = t - st.since;
    if (st.auto) st.step = STEPS[Math.floor(Math.max(0, tt) / PERIOD) % STEPS.length].id;
    const local = st.auto ? Math.max(0, tt) % PERIOD : tt;
    if (st.step === 'bases') drawBases(g, env.view, st, local);
    else if (st.step === 'letters') drawLetters(g, env.view, st, local);
    else drawPhase(g, env.view, st, local);
  },
};
