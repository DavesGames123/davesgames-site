// ============================================================================
//  ALPHA QUDITS  ·  ends/scenes/charge.js  ·  the charge figure
// ----------------------------------------------------------------------------
//  The identification algebra of a (2, 3) link: block-diagonal traceless
//  anti-Hermitian 5 x 5 matrices on C2 (+) C3 (rows 0, 1 the qubit end,
//  rows 2, 3, 4 the qutrit end), the 12 generators e1..e12 of the paper's
//  Sec. S10. The off-diagonal blocks stay zero: the algebra keeps the two
//  ends apart.
//
//  step 'algebra'     the 12 generators one by one, with their action
//                     (xi1 (x) 1 + 1 (x) xi2)|w2> on the pair ket and the
//                     running rank of those actions (computed: 8 of 12).
//  step 'charge'      Q = i diag(3, 3; -2, -2, -2) = 6iY. On the link it
//                     acts as i (computed), and the (3, 2) tensor space has
//                     Y = 1/2 - 1/3 = 1/6, the left-handed quark doublet.
//  step 'stabilizer'  the 4-dimensional null space (computed) and its centre
//                     U = i diag(1, 1; -1, -1, 0): U reads 0 on the pair ket,
//                     and leaves the third qutrit level at zero.
//
//  GREP MAP   (grep -n "<anchor>" charge.js)
//    function fmt ........ complex entry as short text
//    function grid5 ...... the 5 x 5 block matrix
//    function ketRow ..... the 6 entries of an action on the pair ket
//    draw( ............... the frame
// ============================================================================
import { C, font, label, setBounds, clamp, rgba, ease, tile, rrect } from '../draw.js';
import { idBasis, linkAction, pairKet23, actionMatrix, nullSpace, rank, combo, hypercharge, unbroken, cm } from '../linalg.js';

const STEPS = [{ id: 'algebra', label: 'Twelve generators' }, { id: 'charge', label: 'The charge Q' }, { id: 'stabilizer', label: 'Unbroken U' }];
const PERIOD = 13;
const E = idBasis();
const PSI = pairKet23();
const NS = nullSpace(actionMatrix());

function fmt(re, im) {
  const f = x => {
    if (Math.abs(x - Math.round(x)) < 1e-9) return String(Math.round(x));
    const fr = [[1 / 2, '1/2'], [1 / 3, '1/3'], [1 / 6, '1/6'], [2 / 3, '2/3']].find(([v]) => Math.abs(Math.abs(x) - v) < 1e-9);
    return fr ? (x < 0 ? '-' : '') + fr[1] : x.toFixed(2);
  };
  const neg = s => s.replace(/^-/, '\u2212');
  if (Math.abs(re) < 1e-9 && Math.abs(im) < 1e-9) return '';
  if (Math.abs(im) < 1e-9) return neg(f(re));
  if (Math.abs(re) < 1e-9) { const s = f(im); return neg(s === '1' ? 'i' : s === '-1' ? '-i' : s + 'i'); }
  return neg(f(re)) + '+' + neg(f(im)) + 'i';
}
function grid5(g, x, y, s, M, o = {}) {
  // blocks
  rrect(g, x - 3, y - 3, 2 * s + 6, 2 * s + 6, 6); g.strokeStyle = rgba(C.qubit, 0.7); g.lineWidth = 1.5; g.stroke();
  rrect(g, x + 2 * s - 3, y + 2 * s - 3, 3 * s + 6, 3 * s + 6, 6); g.strokeStyle = rgba(C.qutrit, 0.7); g.stroke();
  for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) {
    const re = M.re[i * 5 + j], im = M.im[i * 5 + j], off = (i < 2) !== (j < 2);
    if (off) { g.fillStyle = 'rgba(255,255,255,0.025)'; g.fillRect(x + j * s + 1, y + i * s + 1, s - 2, s - 2); continue; }
    tile(g, x + j * s, y + i * s, s, re, im, o.vmax || 1, { text: fmt(re, im) });
  }
  if (o.labels !== false) {
    label(g, 'qubit block', x + s, y + 5 * s + 14, { font: font(11.5), color: C.qubit });
    label(g, 'qutrit block', x + 3.5 * s, y + 5 * s + 14, { font: font(11.5), color: C.qutrit });
  }
}
function ketRow(g, x, y, s, v, title) {
  label(g, title, x, y - 12, { font: font(12), color: C.dim, align: 'left' });
  const names = ['00', '01', '02', '10', '11', '12'];
  for (let k = 0; k < 6; k++) {
    tile(g, x + k * s, y, s, v.re[k], v.im[k], Math.SQRT1_2 * 3.01, { text: fmt(v.re[k] * Math.SQRT2, v.im[k] * Math.SQRT2) });
    label(g, names[k], x + k * s + s / 2, y + s + 10, { font: font(11), color: C.faint, halo: false });
  }
}
function diagM(vals, imag) { const M = cm(5); vals.forEach((v, k) => { if (imag) M.im[k * 6] = v; else M.re[k * 6] = v; }); return M; }

export default {
  id: 'charge',
  title: 'The charge of the qutrit-qubit link',
  steps: STEPS,
  autoKey: 'step',
  analogy: {
    right: 'Basis changes at the two ends of a link form a block matrix: an su(2) block at the qubit, an su(3) block at the qutrit, and one diagonal direction left over that is a relative phase neither end owns. That leftover direction is Q, and it acts on the pair itself.',
    breaks: 'This is the paper’s identification, shown faithfully, not an established result: the step from this hypercharge direction to electric charge, spacetime and the photon is the paper’s Conjecture 1, and the paper says it lies beyond the Letter.',
  },
  height: W => Math.round(W < 560 ? clamp(W * 1.5, 520, 640) : clamp(W * 0.6, 420, 520)),
  init(p) { return { step: p.step || 'algebra' }; },
  controls() { return [{ key: 'step', label: 'Step', options: STEPS.map(s => ({ v: s.id, label: s.label })) }]; },
  caption(st, t) {
    if (st.step === 'algebra') return 'The twelve generators: three at the qubit, eight at the qutrit, one shared phase. Each acts on the pair ket; the actions are computed and their rank grows to 8, so 4 generators leave the pair alone.';
    if (st.step === 'charge') return 'Q = i diag(3, 3; −2, −2, −2) = 6iY commutes with every generator. On the link it acts as i, because a link pairs one direction of each end: 3 − 2 = 1. The tensor space carries hypercharge ½ − ⅓ = ⅙.';
    return 'The generators that leave the pair ket unchanged form a 4-dimensional algebra; its centre is U = i diag(1, 1; −1, −1, 0). U reads 0 on the pair and leaves the third qutrit level at zero, while Q reads i.';
  },
  draw(g, env, st, t) {
    setBounds(env.view);
    const v = env.view, tt = t - st.since;
    if (st.auto) st.step = STEPS[Math.floor(Math.max(0, tt) / PERIOD) % STEPS.length].id;
    const local = st.auto ? Math.max(0, tt) % PERIOD : Math.max(0, tt);
    const wide = v.w >= 560;
    const s = clamp(Math.min(wide ? v.w * 0.075 : (v.w - 40) / 5, v.h * (wide ? 0.14 : 0.085)), 30, 68);
    const gx = wide ? v.x + v.w * 0.06 : v.x + (v.w - 5 * s) / 2, gy = v.y + 62;
    const px = wide ? gx + 5 * s + Math.max(30, v.w * 0.06) : v.x + 14, py = wide ? gy + 4 : gy + 5 * s + 46;
    const ks = clamp(Math.min((v.w - (wide ? px - v.x : 28) - 14) / 6, 40), 24, 40);
    label(g, 'C² ⊕ C³: block-diagonal, traceless, anti-Hermitian', v.x + v.w / 2, v.y + 14, { font: font(12), color: C.dim });

    if (st.step === 'algebra') {
      const k = Math.floor(local / 0.95) % 12, M = E[k];
      grid5(g, gx, gy, s, M);
      const tag = M.part === 'su(2)' ? C.qubit : M.part === 'su(3)' ? C.qutrit : C.charge;
      label(g, `${M.name}  in ${M.part}`, gx + 2.5 * s, gy - 18, { font: font(15, 600, true, true), color: tag });
      const act = linkAction(M, PSI);
      ketRow(g, px, py + 16, ks, act, 'its action on the pair ket |ω₂⟩, entries |q Q⟩ (×√2)');
      const rows = actionMatrix(), upto = rows.map(r => r.slice(0, k + 1)), rk = rank(upto);
      const yb = py + 16 + ks + 40;
      label(g, `rank of the actions of e1..${M.name}: ${rk}`, px, yb, { font: font(13, 600), color: C.text, align: 'left' });
      // rank bar
      const bw = Math.min(v.w - (px - v.x) - 16, 260);
      g.fillStyle = 'rgba(255,255,255,0.06)'; g.fillRect(px, yb + 12, bw, 10);
      g.fillStyle = rgba(C.read, 0.85); g.fillRect(px, yb + 12, bw * rk / 12, 10);
      g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(px + bw * 8 / 12, yb + 8, 2, 18);
      label(g, '8 of 12: the stabilizer has dimension 4', px, yb + 38, { font: font(12), color: C.dim, align: 'left' });
      const yg = Math.min(v.y + v.h - 30, yb + 62);
      label(g, 'su(3) ⊕ su(2) ⊕ u(1) exponentiates to', v.x + v.w / 2, yg, { font: font(13, 500, true), color: C.charge });
      label(g, 'S(U(3) × U(2)) ≅ (SU(3) × SU(2) × U(1))/Z₆', v.x + v.w / 2, yg + 20, { font: font(13, 600, true), color: C.charge });
    } else if (st.step === 'charge') {
      const Q = E[11], Y = diagM(hypercharge(), false), f = ease(((local % 6) - 2.2) / 1.2);
      const showY = f > 0.5;
      grid5(g, gx, gy, s, showY ? Y : Q, { vmax: showY ? 0.5 : 3 });
      label(g, showY ? 'Y = Q / 6i' : 'Q = i diag(3, 3; −2, −2, −2)', gx + 2.5 * s, gy - 18, { font: font(15, 600, true, true), color: C.charge });
      const act = linkAction(Q, PSI);
      ketRow(g, px, py + 16, ks, act, 'Q on the pair ket (×√2): i times the pair');
      // ratio check: Q psi = lambda psi
      const lam = [act.re[0] * PSI.re[0] + act.re[4] * PSI.re[4], act.im[0] * PSI.re[0] + act.im[4] * PSI.re[4]];
      const yb = py + 16 + ks + 40;
      label(g, `computed: Q|ω₂⟩ = ${fmt(lam[0], lam[1]) || '0'} · |ω₂⟩`, px, yb, { font: font(13, 600), color: C.text, align: 'left' });
      const yv = hypercharge(), y6 = yv[0] + yv[2];
      label(g, `Y on C² ⊗ C³: ${fmt(yv[0], 0)} + (${fmt(yv[2], 0)}) = ${fmt(y6, 0)}`, px, yb + 24, { font: font(13, 500), color: C.charge, align: 'left' });
      label(g, '(3, 2) with Y = 1/6: the left-handed quark doublet', px, yb + 46, { font: font(12), color: C.dim, align: 'left' });
      label(g, 'trace 3 + 3 − 2 − 2 − 2 = 0, yet the pair is charged:', px, yb + 70, { font: font(12), color: C.dim, align: 'left' });
      label(g, 'a link matches one direction of each end, 3 − 2 = 1', px, yb + 88, { font: font(12), color: C.dim, align: 'left' });
    } else {
      const n = NS.length, k = Math.floor(local / 1.6) % (n + 2), isU = k >= n;
      const M = isU ? diagM(unbroken(), true) : combo(NS[k], E);
      grid5(g, gx, gy, s, M, { vmax: isU ? 1 : 3 });
      const nm = isU ? 'U = i diag(1, 1; −1, −1, 0)' : 'stabilizer ' + (k + 1) + ' of ' + n + ': ' + NS[k].map((c, j) => c ? (c > 0 ? '+' : '−') + (Math.abs(c) === 1 ? '' : Math.abs(c)) + 'e' + (j + 1) : '').join('').replace(/^\+/, '').replace(/e12/, 'Q');
      label(g, nm, gx + 2.5 * s, gy - 18, { font: font(wide ? 14 : 12.5, 600, true, true), color: isU ? C.unbr : C.read });
      const act = linkAction(M, PSI);
      ketRow(g, px, py + 16, ks, act, 'its action on the pair ket: zero');
      const yb = py + 16 + ks + 40;
      label(g, `null space of the action, computed: dimension ${n}`, px, yb, { font: font(13, 600), color: C.text, align: 'left' });
      label(g, 'its centre: the line of U, third qutrit level at 0', px, yb + 22, { font: font(12), color: C.unbr, align: 'left' });
      label(g, 'on the pair: Q reads i, U reads 0', px, yb + 44, { font: font(12.5, 600), color: C.text, align: 'left' });
    }
  },
};
